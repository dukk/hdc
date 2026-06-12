import { loadPackageConfigFromPackageRoot } from "../../../lib/package-run-config.mjs";
import { writeResolvedRepoJson } from "../../../../tools/hdc/lib/private-repo.mjs";
import { PACKAGE_CONFIG_EXAMPLE } from "./workers-config.mjs";

/**
 * @param {import('./workers-collect.mjs').WorkersCollectSnapshot} snapshot
 * @param {Map<string, import('./workers-api.mjs').CfWorkerRoute[]>} routesByScriptZone
 */
export function buildImportWorkersEntries(snapshot, routesByScriptZone) {
  /** @type {Record<string, unknown>[]} */
  const workers = [];
  for (const script of snapshot.live_scripts) {
    const name = script.name;
    if (!name) continue;

    /** @type {Record<string, unknown>[]} */
    const routes = [];
    const zoneRoutes = routesByScriptZone.get(name);
    if (zoneRoutes) {
      for (const { zone_name, routes: liveRoutes } of zoneRoutes) {
        for (const r of liveRoutes) {
          if (r.script !== name) continue;
          routes.push({ pattern: r.pattern, zone_name });
        }
      }
    }

    workers.push({
      id: name.replace(/[^a-z0-9-]+/gi, "-").toLowerCase(),
      managed: true,
      project_dir: `workers/${name}`,
      script_name: name,
      npm_install: true,
      routes,
      secrets: [],
    });
  }
  return workers;
}

/**
 * @param {import('./workers-collect.mjs').WorkersCollectSnapshot} snapshot
 */
export function buildImportPagesEntries(snapshot) {
  return snapshot.live_pages.map((p) => ({
    id: p.name.replace(/[^a-z0-9-]+/gi, "-").toLowerCase(),
    managed: true,
    project_dir: `pages/${p.name}`,
    project_name: p.name,
    deploy_dir: "dist",
    npm_install: true,
    create_project: false,
  }));
}

/**
 * @param {object} opts
 * @param {string} opts.packageRoot
 * @param {Record<string, unknown>[]} opts.workers
 * @param {Record<string, unknown>[]} opts.pages
 * @param {(line: string) => void} [opts.log]
 */
export function importWorkersToConfig(opts) {
  const { data: existing, resolved, source } = loadPackageConfigFromPackageRoot(opts.packageRoot, {
    exampleRel: PACKAGE_CONFIG_EXAMPLE,
    bootstrapFromExample: true,
    log: opts.log ? (line) => opts.log?.(line.replace(/\n$/, "")) : undefined,
  });

  const merged = {
    ...existing,
    schema_version: typeof existing.schema_version === "number" ? existing.schema_version : 1,
    workers: opts.workers,
    pages: opts.pages,
  };

  writeResolvedRepoJson(resolved, merged, {
    compactArrayKeys: ["workers", "pages", "routes", "secrets"],
  });

  if (opts.log) {
    opts.log(
      `wrote ${resolved.rel} (${opts.workers.length} worker(s), ${opts.pages.length} pages project(s)) from ${source}`
    );
  }

  return { configRel: resolved.rel, source, workers: opts.workers, pages: opts.pages };
}
