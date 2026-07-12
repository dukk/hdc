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
      else if (name === "run.mjs") out.push(p);
    }
  }
  walk(join(dir, "clumps"));
  return out;
}

function exampleRelFor(filePath) {
  const pkgDir = dirname(dirname(filePath));
  return `${relative(root, pkgDir).replace(/\\/g, "/")}/config.example.json`;
}

function patch(content, filePath) {
  let next = content;
  const exampleRel = exampleRelFor(filePath);

  next = next.replace(/;import /g, ";\nimport ");
  next = next.replace(/const ensurePackageConfig\(\)\.path = join\([^)]+\);\n/g, "");

  if (next.includes("loadClumpConfigFromClumpRoot") && !next.includes("CLUMP_CONFIG_EXAMPLE")) {
    const block = `
const CLUMP_CONFIG_EXAMPLE = "${exampleRel}";
/** @type {{ data: Record<string, unknown>; path: string; source: string } | null} */
let _pkgConfig = null;
function ensurePackageConfig() {
  if (!_pkgConfig) {
    _pkgConfig = loadClumpConfigFromClumpRoot(clumpRoot, { exampleRel: CLUMP_CONFIG_EXAMPLE });
  }
  return _pkgConfig;
}
`;
    if (/\bconst clumpRoot\b/.test(next)) {
      next = next.replace(/(const clumpRoot = join\(here, "\.\."\);)/, `$1${block}`);
    }
  }

  if (next.includes("function loadCfg()") && next.includes("CLUMP_CONFIG_EXAMPLE") && !next.includes("let _pkgConfig")) {
    const block = `
const CLUMP_CONFIG_EXAMPLE = "${exampleRel}";
/** @type {{ data: Record<string, unknown>; path: string; source: string } | null} */
let _pkgConfig = null;
`;
    next = next.replace(/(const clumpRoot = join\(here, "\.\."\);)/, `$1${block}`);
  }

  return next;
}

for (const f of collectRunMjs(root)) {
  const raw = readFileSync(f, "utf8");
  const next = patch(raw, f);
  if (next !== raw) {
    writeFileSync(f, next, "utf8");
    console.log("repaired", relative(root, f).replace(/\\/g, "/"));
  }
}
