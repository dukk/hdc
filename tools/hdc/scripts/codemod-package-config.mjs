#!/usr/bin/env node
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..", "..", "..");

function collectRunMjs(dir) {
  /** @type {string[]} */
  const out = [];
  function walk(d) {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name === "run.mjs" && /[\\/](deploy|maintain|query|teardown)[\\/]/.test(p)) {
        out.push(p);
      }
    }
  }
  for (const rel of ["packages/services", "packages/infrastructure"]) {
    walk(join(dir, rel));
  }
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

function patchFile(content, filePath) {
  if (content.includes("package-run-config.mjs")) return content;
  const hasReadCfg = /function readCfg\(\)/.test(content);
  const hasLoadCfg = /function loadCfg\(\)/.test(content);
  if (!hasReadCfg && !hasLoadCfg) return content;

  const exampleRel = exampleRelFor(filePath);
  const importPath = importPathFor(filePath);
  let next = content;

  const importLine = `import { loadPackageConfigFromPackageRoot, tryLoadPackageConfigFromPackageRoot } from "${importPath}";\n`;
  const shebangEnd = next.startsWith("#!") ? next.indexOf("\n") + 1 : 0;
  const body = next.slice(shebangEnd);
  const imports = [...body.matchAll(/^import .+;$/gm)];
  if (imports.length) {
    const last = imports[imports.length - 1];
    const insertAt = shebangEnd + (last.index ?? 0) + last[0].length + 1;
    next = next.slice(0, insertAt) + importLine + next.slice(insertAt);
  }

  if (!/\bconst packageRoot\b/.test(next) && /\bconst here\b/.test(next)) {
    next = next.replace(
      /(const here = dirname\(fileURLToPath\(import\.meta\.url\)\);[^\n]*\n)/,
      `$1const packageRoot = join(here, "..");\n`,
    );
  }

  const loaderBlock = `
const PACKAGE_CONFIG_EXAMPLE = "${exampleRel}";
/** @type {{ data: Record<string, unknown>; path: string; source: string } | null} */
let _pkgConfig = null;
function ensurePackageConfig() {
  if (!_pkgConfig) {
    _pkgConfig = loadPackageConfigFromPackageRoot(packageRoot, { exampleRel: PACKAGE_CONFIG_EXAMPLE });
  }
  return _pkgConfig;
}
`;

  if (!next.includes("ensurePackageConfig")) {
    next = next.replace(/const cfgPath = join\([^)]+\);\n/g, "");
    if (hasReadCfg) {
      next = next.replace(/function readCfg\(\) \{[\s\S]*?\n\}/, `function readCfg() {
  return ensurePackageConfig().data;
}`);
      next = next.replace(
        /(const packageRoot = join\(here, "\.\."\);)/,
        `$1${loaderBlock}`,
      );
      if (!next.includes("ensurePackageConfig")) {
        const anchor = next.indexOf("function readCfg");
        if (anchor > 0) {
          next = next.slice(0, anchor) + loaderBlock + next.slice(anchor);
        }
      }
    }
    if (hasLoadCfg) {
      next = next.replace(/function loadCfg\(\) \{[\s\S]*?\n\}/, `function loadCfg() {
  const loaded = tryLoadPackageConfigFromPackageRoot(packageRoot, { exampleRel: PACKAGE_CONFIG_EXAMPLE });
  if (loaded.ok && loaded.data) {
    _pkgConfig = { data: loaded.data, path: loaded.path, source: loaded.source };
  }
  return loaded;
}`);
      if (!next.includes("ensurePackageConfig") && !next.includes("PACKAGE_CONFIG_EXAMPLE")) {
        const anchor = next.indexOf("function loadCfg");
        if (anchor > 0) {
          next = next.slice(0, anchor) + loaderBlock + next.slice(anchor);
        }
      }
    }
    next = next.replace(/\bcfgPath\b/g, "ensurePackageConfig().path");
  }

  return next;
}

const files = collectRunMjs(root);
let changed = 0;
for (const f of files) {
  const raw = readFileSync(f, "utf8");
  const patched = patchFile(raw, f);
  if (patched !== raw) {
    writeFileSync(f, patched, "utf8");
    changed += 1;
    console.log("patched", relative(root, f).replace(/\\/g, "/"));
  }
}
console.log(`done: ${changed} files`);
