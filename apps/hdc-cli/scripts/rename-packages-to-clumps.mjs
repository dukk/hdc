#!/usr/bin/env node
/**
 * One-shot migration: packages/ → clumps/, tools/hdc/ → apps/hdc-cli/, clump terminology.
 * Usage: node apps/hdc-cli/scripts/rename-packages-to-clumps.mjs [--root <path>] [--dry-run]
 */
import { existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultRoot = join(__dirname, "..", "..", "..");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const rootIdx = args.indexOf("--root");
const roots =
  rootIdx >= 0 && args[rootIdx + 1]
    ? [args[rootIdx + 1]]
    : [defaultRoot, join(defaultRoot, "..", "hdc-private")];

const SKIP_DIRS = new Set(["node_modules", ".git", "coverage", "homepage", "icons"]);

/** @type {[string, string][]} longest-first symbol/path replacements */
const REPLACEMENTS = [
  ["loadPackageConfigFromPackageRoot", "loadClumpConfigFromClumpRoot"],
  ["tryLoadPackageConfigFromPackageRoot", "tryLoadClumpConfigFromClumpRoot"],
  ["tryLoadPackageConfigOrExample", "tryLoadClumpConfigOrExample"],
  ["bootstrapPackageConfigFromExample", "bootstrapClumpConfigFromExample"],
  ["maybeBootstrapPackageConfig", "maybeBootstrapClumpConfig"],
  ["packageRootFromScriptDir", "clumpRootFromScriptDir"],
  ["packageRootFromMeta", "clumpRootFromMeta"],
  ["resolvePackageConfig", "resolveClumpConfig"],
  ["preferredClumpReportPath", "preferredClumpReportPath"],
  ["packageManifestIds", "clumpManifestIds"],
  ["buildPackageRunEnv", "buildClumpRunEnv"],
  ["discoverPackages", "discoverClumps"],
  ["PACKAGE_CONFIG_EXAMPLE", "CLUMP_CONFIG_EXAMPLE"],
  ["packageConfigRel", "clumpConfigRel"],
  ["packagesDirAbs", "clumpsDirAbs"],
  ["packagesDir", "clumpsDir"],
  ["ensure-package-env-examples", "ensure-clump-env-examples"],
  ["package-run-config.mjs", "clump-run-config.mjs"],
  ["package-config.test.mjs", "clump-config.test.mjs"],
  ["package-config.mjs", "clump-config.mjs"],
  ["package-env.test.mjs", "clump-env.test.mjs"],
  ["package-env.mjs", "clump-env.mjs"],
  ["env-key-packages.mjs", "env-key-clumps.mjs"],
  ["package.manifest.schema.json", "clump.manifest.schema.json"],
  ['join("tools", "hdc", "reports"', 'join("apps", "hdc-cli", "reports"'],
  ["tools\\hdc\\", "apps\\hdc-cli\\"],
  ["tools/hdc/", "apps/hdc-cli/"],
  ["packages/", "clumps/"],
  ["parent of `tools/`", "parent of `apps/hdc-cli/`"],
  ["HDC packages under `packages/", "HDC clumps under `clumps/"],
  ["from packages/*/manifest.json", "from clumps/*/manifest.json"],
  ["Package scripts live under packages/", "Clump scripts live under clumps/"],
  ["show hdc packages (from packages", "show hdc clumps (from clumps"],
  ["packages/infrastructure/", "clumps/infrastructure/"],
  ["packages/services/", "clumps/services/"],
  ["packages/clients/", "clumps/clients/"],
  ["packages/<tier>", "clumps/<tier>"],
  ["packages/lib/", "clumps/lib/"],
  ["per-package:", "per-clump:"],
  ["per-package ", "per-clump "],
  ["Optional per-package config", "Optional per-clump config"],
  ["<package>", "<clump>"],
  ["<package> is the manifest", "<clump> is the manifest"],
  ["the packages/ folder name", "the clumps/ folder name"],
  ["after adding a package", "after adding a clump"],
  ["the target package", "the target clump"],
  ["every package under", "every clump under"],
  ["Package `config.json`", "Clump `config.json`"],
  ["package `config.json`", "clump `config.json`"],
  ["package `.env`", "clump `.env`"],
  ["package config", "clump config"],
  ["Package config", "Clump config"],
  ["package scripts", "clump scripts"],
  ["Package scripts", "Clump scripts"],
  ["package id", "clump id"],
  ["package root", "clump root"],
  ["packageRoot", "clumpRoot"],
  ["packageId", "clumpId"],
  ["packageTitle", "clumpTitle"],
  ["package_id", "clump_id"],
  ["listPackageCatalog", "listClumpCatalog"],
  ["hdc-runner-ui-packages.mjs", "hdc-runner-ui-clumps.mjs"],
  ["ui-packages", "ui-clumps"],
];

const EXTENSIONS = new Set([
  ".mjs",
  ".js",
  ".json",
  ".md",
  ".mdc",
  ".yml",
  ".yaml",
  ".example",
  ".cmd",
  ".sh",
  ".html",
  ".css",
  ".workspace",
]);

/**
 * @param {string} dir
 * @param {string[]} out
 */
function walk(dir, out) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      walk(p, out);
      continue;
    }
    const ext = name.includes(".") ? name.slice(name.indexOf(".")) : "";
    if (EXTENSIONS.has(ext) || name === "hdc" || name === ".env.example" || name === ".gitignore") {
      out.push(p);
    }
  }
}

/**
 * @param {string} text
 */
function applyReplacements(text) {
  let out = text;
  for (const [from, to] of REPLACEMENTS) {
    out = out.split(from).join(to);
  }
  return out;
}

/** @type {{ root: string; path: string; changed: boolean }[]} */
const changed = [];

for (const root of roots) {
  if (!existsSync(root)) {
    console.error(`skip missing root: ${root}`);
    continue;
  }
  console.error(`processing ${root}`);
  /** @type {string[]} */
  const files = [];
  walk(root, files);
  for (const file of files) {
    if (file.includes("rename-packages-to-clumps.mjs")) continue;
    const before = readFileSync(file, "utf8");
    const after = applyReplacements(before);
    if (after !== before) {
      changed.push({ root, path: file, changed: true });
      if (!dryRun) writeFileSync(file, after, "utf8");
    }
  }
}

/** File renames within hdc public repo only */
const FILE_RENAMES = [
  ["apps/hdc-cli/lib/package-config.mjs", "apps/hdc-cli/lib/clump-config.mjs"],
  ["apps/hdc-cli/lib/package-config.test.mjs", "apps/hdc-cli/lib/clump-config.test.mjs"],
  ["apps/hdc-cli/lib/package-env.mjs", "apps/hdc-cli/lib/clump-env.mjs"],
  ["apps/hdc-cli/lib/package-env.test.mjs", "apps/hdc-cli/lib/clump-env.test.mjs"],
  ["apps/hdc-cli/lib/ensure-package-env-examples.mjs", "apps/hdc-cli/lib/ensure-clump-env-examples.mjs"],
  ["apps/hdc-cli/lib/ensure-package-env-examples.test.mjs", "apps/hdc-cli/lib/ensure-clump-env-examples.test.mjs"],
  ["apps/hdc-cli/lib/env-key-packages.mjs", "apps/hdc-cli/lib/env-key-clumps.mjs"],
  ["apps/hdc-cli/scripts/ensure-package-env-examples.mjs", "apps/hdc-cli/scripts/ensure-clump-env-examples.mjs"],
  ["apps/hdc-cli/schema/package.manifest.schema.json", "apps/hdc-cli/schema/clump.manifest.schema.json"],
  ["clumps/lib/package-run-config.mjs", "clumps/lib/clump-run-config.mjs"],
  [
    "clumps/services/hdc-runner/lib/hdc-runner-ui-packages.mjs",
    "clumps/services/hdc-runner/lib/hdc-runner-ui-clumps.mjs",
  ],
];

const hdcRoot = defaultRoot;
for (const [fromRel, toRel] of FILE_RENAMES) {
  const from = join(hdcRoot, fromRel);
  const to = join(hdcRoot, toRel);
  if (!existsSync(from)) continue;
  console.error(`${dryRun ? "would rename" : "rename"} ${fromRel} → ${toRel}`);
  if (!dryRun) {
    renameSync(from, to);
  }
}

console.error(`updated ${changed.length} files${dryRun ? " (dry-run)" : ""}`);
