import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import { hdcPrivateRoot } from "./private-repo.mjs";

const PACKAGE_BASES = ["packages/infrastructure", "packages/services", "packages/clients"];

/**
 * @param {string} rootDir
 * @param {string} dir
 * @param {(rel: string, abs: string) => void} fn
 */
function walkFiles(rootDir, dir, fn) {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) walkFiles(rootDir, abs, fn);
    else fn(relative(rootDir, abs).replace(/\\/g, "/"), abs);
  }
}

/**
 * @param {string[]} argv
 */
export function parseBootstrapArgs(argv) {
  /** @type {{ dryRun: boolean; force: boolean; privateRoot: string | null }} */
  const opts = { dryRun: false, force: false, privateRoot: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--force") opts.force = true;
    else if (a === "--private-root") {
      const next = argv[i + 1];
      if (!next || next.startsWith("-")) {
        throw new Error("--private-root requires a path");
      }
      opts.privateRoot = next;
      i++;
    } else if (a === "--help" || a === "-h") {
      return { ...opts, help: true };
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }
  return opts;
}

/**
 * @param {string} publicRoot
 * @param {{ privateRoot?: string | null; env?: NodeJS.ProcessEnv }} [opts]
 */
export function resolveBootstrapPrivateRoot(publicRoot, opts = {}) {
  const env = opts.env ?? process.env;
  if (opts.privateRoot) {
    return resolve(opts.privateRoot);
  }
  const fromEnv =
    typeof env.HDC_PRIVATE_ROOT === "string" && env.HDC_PRIVATE_ROOT.trim()
      ? resolve(env.HDC_PRIVATE_ROOT.trim())
      : "";
  if (fromEnv) return fromEnv;
  return hdcPrivateRoot(publicRoot, env) ?? join(publicRoot, "..", "hdc-private");
}

/**
 * @param {string} publicRoot
 * @param {{ dryRun?: boolean; force?: boolean; privateRoot?: string | null; env?: NodeJS.ProcessEnv; log?: (line: string) => void }} [opts]
 */
export function runBootstrapHdcPrivateConfigs(publicRoot, opts = {}) {
  const log = opts.log ?? ((line) => console.error(line));
  const privateRoot = resolveBootstrapPrivateRoot(publicRoot, opts);
  const dryRun = Boolean(opts.dryRun);
  const force = Boolean(opts.force);

  if (!dryRun) {
    mkdirSync(privateRoot, { recursive: true });
  }

  /** @type {string[]} */
  const created = [];
  /** @type {string[]} */
  const overwritten = [];
  /** @type {string[]} */
  const skipped = [];
  /** @type {string[]} */
  const wouldCreate = [];
  /** @type {string[]} */
  const wouldOverwrite = [];

  for (const base of PACKAGE_BASES) {
    const absBase = join(publicRoot, base);
    if (!existsSync(absBase)) continue;

    walkFiles(absBase, absBase, (rel, abs) => {
      if (!rel.endsWith("config.example.json")) return;

      const destRel = join(base, rel.replace(/config\.example\.json$/, "config.json")).replace(/\\/g, "/");
      const dest = join(privateRoot, destRel);
      const destExists = existsSync(dest);

      if (destExists && !force) {
        skipped.push(destRel);
        log(`skip  ${destRel}`);
        return;
      }

      if (dryRun) {
        if (destExists) {
          wouldOverwrite.push(destRel);
          log(`would overwrite  ${destRel}`);
        } else {
          wouldCreate.push(destRel);
          log(`would create  ${destRel}`);
        }
        return;
      }

      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(abs, dest);

      if (destExists) {
        overwritten.push(destRel);
        log(`overwrite  ${destRel}`);
      } else {
        created.push(destRel);
        log(`create  ${destRel}`);
      }
    });
  }

  const summary = {
    privateRoot,
    dryRun,
    force,
    created: created.length,
    overwritten: overwritten.length,
    skipped: skipped.length,
    wouldCreate: wouldCreate.length,
    wouldOverwrite: wouldOverwrite.length,
    createdPaths: created,
    overwrittenPaths: overwritten,
    skippedPaths: skipped,
    wouldCreatePaths: wouldCreate,
    wouldOverwritePaths: wouldOverwrite,
  };

  log("");
  log(`Private root: ${privateRoot}`);
  if (dryRun) {
    log(
      `Dry run: would create ${wouldCreate.length}, would overwrite ${wouldOverwrite.length}, would skip ${skipped.length}`,
    );
  } else {
    log(`Done: created ${created.length}, overwritten ${overwritten.length}, skipped ${skipped.length}`);
  }

  return summary;
}
