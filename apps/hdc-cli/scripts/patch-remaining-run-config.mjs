#!/usr/bin/env node
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function collectRunMjs(dir) {
  /** @type {string[]} */
  const out = [];
  function walk(d) {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name === "run.mjs") out.push(p);
    }
  }
  walk(join(dir, "packages"));
  return out;
}

function exampleRelFor(filePath) {
  const pkgDir = dirname(dirname(filePath));
  return `${relative(root, pkgDir).replace(/\\/g, "/")}/config.example.json`;
}

function importPathFor(filePath) {
  const libPath = join(root, "packages", "lib", "package-run-config.mjs");
  return relative(dirname(filePath), libPath).replace(/\\/g, "/");
}

function patch(content, filePath) {
  if (content.includes("ensurePackageConfig")) return content;
  if (!content.includes('config.json"')) return content;
  if (!content.includes("const cfgPath") && !content.includes("const configPath")) return content;

  const exampleRel = exampleRelFor(filePath);
  const importPath = importPathFor(filePath);
  let next = content;

  if (!next.includes("package-run-config")) {
    const importLine = `import { loadPackageConfigFromPackageRoot, tryLoadPackageConfigFromPackageRoot } from "${importPath}";\n`;
    const shebangEnd = next.startsWith("#!") ? next.indexOf("\n") + 1 : 0;
    const body = next.slice(shebangEnd);
    const imports = [...body.matchAll(/^import .+;$/gm)];
    if (imports.length) {
      const last = imports[imports.length - 1];
      const insertAt = shebangEnd + (last.index ?? 0) + last[0].length + 1;
      next = next.slice(0, insertAt) + importLine + next.slice(insertAt);
    }
  }

  if (!/\bconst packageRoot\b/.test(next) && /\bconst here\b/.test(next)) {
    next = next.replace(
      /(const here = dirname\(fileURLToPath\(import\.meta\.url\)\);[^\n]*\n)/,
      `$1const packageRoot = join(here, "..");\n`,
    );
  }

  const block = `
const PACKAGE_CONFIG_EXAMPLE = "${exampleRel}";
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
`;

  if (!next.includes("ensurePackageConfig")) {
    if (/\bconst packageRoot\b/.test(next)) {
      next = next.replace(/(const packageRoot = join\([^)]+\);)/, `$1${block}`);
    } else if (/\bconst here\b/.test(next)) {
      next = next.replace(/(const here = dirname\(fileURLToPath\(import\.meta\.url\)\);[^\n]*\n)/, `$1const packageRoot = join(here, "..");${block}`);
    }
  }

  next = next.replace(/const cfgPath = join\([^)]+\);\r?\n/g, "");
  next = next.replace(/const configPath = join\(packageRoot, "config\.json"\);\r?\n/g, "");

  // bind/query style: if (!existsSync(cfgPath))
  next = next.replace(
    /if \(!existsSync\(cfgPath\)\) \{[\s\S]*?return;\s*\}\s*\r?\n\s*const cfg = JSON\.parse\(readFileSync\(cfgPath, "utf8"\)\);/g,
    "const cfg = readCfg();",
  );
  next = next.replace(
    /if \(!existsSync\(cfgPath\)\) \{[\s\S]*?process\.exitCode = 1;\s*return;\s*\}\s*\r?\n\s*const cfg = JSON\.parse\(readFileSync\(cfgPath, "utf8"\)\);/g,
    "const cfg = readCfg();",
  );

  next = next.replace(/\bcfgPath\b/g, "ensurePackageConfig().path");

  return next;
}

for (const f of collectRunMjs(root)) {
  const raw = readFileSync(f, "utf8");
  const next = patch(raw, f);
  if (next !== raw) {
    writeFileSync(f, next, "utf8");
    console.log("patched", relative(root, f).replace(/\\/g, "/"));
  }
}
