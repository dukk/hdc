import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import { bootstrapClumpConfigFromExample } from "./clump-config.mjs";
import { hdcPrivateRoot } from "./private-repo.mjs";
const PACKAGE_BASES = ["clumps/infrastructure", "clumps/services", "clumps/clients"];

/**
 * @param {string} publicRoot
 * @param {string} destRel repo-relative `.env` path
 * @param {string} exampleRel repo-relative `.env.example` path
 * @param {{ env?: NodeJS.ProcessEnv; force?: boolean; dryRun?: boolean; privateRoot?: string | null; log?: (line: string) => void }} [opts]
 */
export function bootstrapPackageEnvFromExample(publicRoot, destRel, exampleRel, opts = {}) {
  const env = opts.env ?? process.env;
  const force = Boolean(opts.force);
  const dryRun = Boolean(opts.dryRun);
  const logFn = opts.log;
  const rel = destRel.replace(/\\/g, "/");
  const example = exampleRel.replace(/\\/g, "/");

  /** @type {string} */
  let destPath;
  let destExists = false;

  if (opts.privateRoot) {
    destPath = join(resolve(opts.privateRoot), rel);
    destExists = existsSync(destPath);
  } else {
    const privateRoot = hdcPrivateRoot(publicRoot, env);
    destPath = privateRoot ? join(privateRoot, rel) : join(publicRoot, rel);
    destExists = existsSync(destPath);
  }

  const examplePath = join(publicRoot, example);
  if (!existsSync(examplePath)) {
    return { action: "missing_example", rel, exampleRel: example };
  }

  if (destExists && !force) {
    if (logFn) logFn(`skip  ${rel}`);
    return { action: "skipped", rel, path: destPath };
  }

  if (dryRun) {
    const action = destExists ? "would_overwrite" : "would_create";
    if (logFn) logFn(`${destExists ? "would overwrite" : "would create"}  ${rel}`);
    return { action, rel, path: destPath };
  }

  mkdirSync(dirname(destPath), { recursive: true });
  copyFileSync(examplePath, destPath);

  const action = destExists ? "overwritten" : "created";
  if (logFn) logFn(`${destExists ? "overwrite" : "create"}  ${rel}`);
  return { action, rel, path: destPath };
}

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
 * @param {{ action: string }} result
 * @param {string} destRel
 * @param {{ created: string[]; overwritten: string[]; skipped: string[]; wouldCreate: string[]; wouldOverwrite: string[] }} buckets
 */
function recordBootstrapResult(result, destRel, buckets) {
  switch (result.action) {
    case "created":
      buckets.created.push(destRel);
      break;
    case "overwritten":
      buckets.overwritten.push(destRel);
      break;
    case "skipped":
      buckets.skipped.push(destRel);
      break;
    case "would_create":
      buckets.wouldCreate.push(destRel);
      break;
    case "would_overwrite":
      buckets.wouldOverwrite.push(destRel);
      break;
    default:
      break;
  }
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

    walkFiles(absBase, absBase, (rel) => {
      if (rel.endsWith("config.example.json")) {
        const destRel = join(base, rel.replace(/config\.example\.json$/, "config.json")).replace(/\\/g, "/");
        const exampleRel = join(base, rel).replace(/\\/g, "/");
        recordBootstrapResult(
          bootstrapClumpConfigFromExample(publicRoot, destRel, exampleRel, {
            env: opts.env,
            force,
            dryRun,
            privateRoot,
            log,
          }),
          destRel,
          { created, overwritten, skipped, wouldCreate, wouldOverwrite },
        );
        return;
      }

      if (rel.endsWith(".env.example")) {
        const destRel = join(base, rel.replace(/\.env\.example$/, ".env")).replace(/\\/g, "/");
        const exampleRel = join(base, rel).replace(/\\/g, "/");
        recordBootstrapResult(
          bootstrapPackageEnvFromExample(publicRoot, destRel, exampleRel, {
            env: opts.env,
            force,
            dryRun,
            privateRoot,
            log,
          }),
          destRel,
          { created, overwritten, skipped, wouldCreate, wouldOverwrite },
        );
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
