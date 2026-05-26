#!/usr/bin/env node
/**
 * Query nginx web node health.
 */
import { basename, dirname, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stderr as errout } from "node:process";

import { parseArgvFlags } from "../../../lib/parse-argv-flags.mjs";
import {
  nginxGlobalSettings,
  normalizeNginxConfig,
  resolveNginxDeployments,
  sshTargetFromDeployment,
} from "../lib/deployments.mjs";
import { createConfigureExec } from "../lib/nginx-configure.mjs";
import { queryCertExpiry } from "../lib/letsencrypt.mjs";
import { siteId, tlsDomainsFromSites } from "../lib/nginx-render.mjs";import { loadPackageConfigFromPackageRoot, tryLoadPackageConfigFromPackageRoot } from "../../../lib/package-run-config.mjs";


const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, "..");
const PACKAGE_CONFIG_EXAMPLE = "packages/services/nginx/config.example.json";
/** @type {{ data: Record<string, unknown>; path: string; source: string } | null} */
let _pkgConfig = null;
function ensurePackageConfig() {
  if (!_pkgConfig) {
    _pkgConfig = loadPackageConfigFromPackageRoot(packageRoot, { exampleRel: PACKAGE_CONFIG_EXAMPLE });
  }
  return _pkgConfig;
}
function readCfg() {
  return ensurePackageConfig().data;
}
function tryCfg() {
  return tryLoadPackageConfigFromPackageRoot(packageRoot, { exampleRel: PACKAGE_CONFIG_EXAMPLE });
}

const target = basename(dirname(here));
const verb = basename(here);

/**
 * @param {ReturnType<typeof createConfigureExec>} exec
 */
function queryNginxActive(exec) {
  const r = exec.run("systemctl is-active nginx 2>/dev/null || echo inactive", { capture: true });
  const active = r.stdout.trim() === "active";
  return { active, raw: r.stdout.trim() };
}

/**
 * @param {ReturnType<typeof createConfigureExec>} exec
 */
function queryNginxTest(exec) {
  const r = exec.run("nginx -t 2>&1", { capture: true });
  return { ok: r.status === 0, output: `${r.stdout}${r.stderr}`.trim().slice(0, 500) };
}

/**
 * @param {ReturnType<typeof createConfigureExec>} exec
 */
function queryEnabledSites(exec) {
  const r = exec.run("ls -1 /etc/nginx/sites-enabled/hdc-*.conf 2>/dev/null | xargs -r basename -a", {
    capture: true,
  });
  const ids = r.stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((f) => f.replace(/^hdc-/, "").replace(/\.conf$/, ""));
  return ids;
}

/**
 * @param {ReturnType<typeof createConfigureExec>} exec
 * @param {string} upstream
 */
function probeUpstream(exec, upstream) {
  const r = exec.run(
    `curl -fsS -o /dev/null -w '%{http_code}' --connect-timeout 3 ${upstream} 2>/dev/null || echo fail`,
    { capture: true },
  );
  const code = r.stdout.trim();
  return { upstream, ok: code !== "fail" && r.status === 0, http_code: code };
}

async function main() {
  errout.write(`[hdc] ${target} ${verb}: nginx web health check (JSON on stdout).\n`);

  const cfg = readCfg();
  const flags = parseArgvFlags(process.argv.slice(2));
  const normalized = normalizeNginxConfig(cfg);
  const global = nginxGlobalSettings(normalized);
  const deployments = resolveNginxDeployments(cfg, flags);
  const sites = /** @type {Record<string, unknown>[]} */ (global.sites);
  const domains = tlsDomainsFromSites(sites);

  /** @type {Record<string, unknown>[]} */
  const nodes = [];

  for (const d of deployments) {
    const { user, host } = sshTargetFromDeployment(d);
    errout.write(`[hdc] ${target} ${verb}: checking ${d.systemId} at ${user}@${host} …\n`);
    const exec = createConfigureExec("ssh", { user, host });
    const nginx = queryNginxActive(exec);
    const configTest = queryNginxTest(exec);
    const enabledSites = queryEnabledSites(exec);

    /** @type {Record<string, unknown>[]} */
    const siteProbes = [];
    for (const site of sites) {
      const upstream =
        typeof site.upstream === "string" && site.upstream.trim() ? site.upstream.trim() : "";
      if (upstream) {
        siteProbes.push({
          id: siteId(site),
          probe: probeUpstream(exec, upstream),
        });
      }
    }

    /** @type {Record<string, unknown>[]} */
    const certs = domains.map((domain) => ({
      ...queryCertExpiry(exec, domain),
    }));

    nodes.push({
      system_id: d.systemId,
      host,
      nginx,
      config_test: configTest,
      enabled_sites: enabledSites,
      site_probes: siteProbes,
      certificates: certs,
      ok: nginx.active && configTest.ok,
    });
  }

  const ok = nodes.length > 0 && nodes.every((n) => n.ok);
  process.stdout.write(
    `${JSON.stringify(
      {
        ok,
        target,
        verb,
        nodes,
        generated_at: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
  process.exitCode = ok ? 0 : 1;
}

main().catch((e) => {
  errout.write(`[hdc] ${target} ${verb}: fatal: ${/** @type {Error} */ (e).stack || e}\n`);
  process.stdout.write(
    `${JSON.stringify({ ok: false, target, verb, message: String(/** @type {Error} */ (e).message || e) }, null, 2)}\n`,
  );
  process.exitCode = 1;
});
