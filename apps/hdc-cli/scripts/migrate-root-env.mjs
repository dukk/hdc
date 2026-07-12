#!/usr/bin/env node
/**
 * Move package-scoped keys from root `.env` into hdc-private clump `.env` files.
 *
 * Usage: node apps/hdc-cli/scripts/migrate-root-env.mjs [--dry-run] [--private-root <path>]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseBootstrapArgs, resolveBootstrapPrivateRoot } from "../lib/bootstrap-hdc-private-configs.mjs";
import { isGlobalEnvKey, clumpIdForEnvKey } from "../lib/clump-env.mjs";
import { parseDotenvText } from "../env.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const publicRoot = join(scriptDir, "../../..");

/**
 * @param {string} clumpId
 */
function packageEnvRel(clumpId) {
  for (const tier of ["infrastructure", "services", "clients"]) {
    if (existsSync(join(publicRoot, "clumps", tier, clumpId, "manifest.json"))) {
      return `clumps/${tier}/${clumpId}/.env`.replace(/\\/g, "/");
    }
  }
  return `clumps/services/${clumpId}/.env`;
}

/**
 * @param {string} path
 * @param {{ key: string; value: string }} entry
 */
function appendEnvEntry(path, entry) {
  const line = `${entry.key}=${entry.value.includes(" ") ? JSON.stringify(entry.value) : entry.value}\n`;
  if (existsSync(path)) {
    const existing = readFileSync(path, "utf8");
    if (existing.includes(`${entry.key}=`)) return false;
    writeFileSync(path, existing.endsWith("\n") ? existing + line : `${existing}\n${line}`, "utf8");
  } else {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, line, "utf8");
  }
  return true;
}

function main() {
  const args = process.argv.slice(2);
  let opts;
  try {
    opts = parseBootstrapArgs(args);
  } catch (e) {
    console.error(String(/** @type {Error} */ (e).message || e));
    process.exit(2);
  }
  if (opts.help) {
    console.error("Usage: migrate-root-env.mjs [--dry-run] [--private-root <path>]");
    process.exit(0);
  }

  const rootEnvPath = join(publicRoot, ".env");
  if (!existsSync(rootEnvPath)) {
    console.error("No root .env found");
    process.exit(1);
  }

  const privateRoot = resolveBootstrapPrivateRoot(publicRoot, opts);
  const pairs = parseDotenvText(readFileSync(rootEnvPath, "utf8"));

  /** @type {Map<string, { key: string; value: string }[]>} */
  const byPackage = new Map();
  /** @type {string[]} */
  const stayGlobal = [];

  for (const entry of pairs) {
    if (isGlobalEnvKey(entry.key)) {
      stayGlobal.push(entry.key);
      continue;
    }
    const pkg = clumpIdForEnvKey(entry.key);
    if (!pkg) {
      console.error(`skip  ${entry.key} (no package mapping)`);
      continue;
    }
    if (!byPackage.has(pkg)) byPackage.set(pkg, []);
    byPackage.get(pkg).push(entry);
  }

  /** @type {string[]} */
  const moved = [];
  for (const [pkg, entries] of byPackage) {
    const rel = packageEnvRel(pkg);
    const dest = join(privateRoot, rel);
    for (const entry of entries) {
      if (opts.dryRun) {
        console.error(`would move ${entry.key} -> ${rel}`);
        moved.push(entry.key);
      } else if (appendEnvEntry(dest, entry)) {
        console.error(`move  ${entry.key} -> ${rel}`);
        moved.push(entry.key);
      } else {
        console.error(`skip  ${entry.key} (already in ${rel})`);
      }
    }
  }

  if (!opts.dryRun && moved.length) {
    const movedSet = new Set(moved);
    const kept = pairs.filter((p) => !movedSet.has(p.key));
    const commentLines = readFileSync(rootEnvPath, "utf8")
      .split(/\r?\n/)
      .filter((l) => l.trim().startsWith("#") || !l.trim());
    const body = kept.map((p) => `${p.key}=${p.value}`).join("\n");
    const comments = commentLines.join("\n");
    writeFileSync(
      rootEnvPath,
      `${comments.trimEnd()}\n${body ? `\n${body}\n` : "\n"}`,
      "utf8",
    );
  }

  console.error("");
  console.error(
    `Summary: ${moved.length} key(s) ${opts.dryRun ? "would move" : "moved"}, ${stayGlobal.length} global key(s) kept`,
  );
}

main();
