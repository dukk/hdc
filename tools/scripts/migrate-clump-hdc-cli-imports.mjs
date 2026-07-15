#!/usr/bin/env node
/**
 * Rewrite relative apps/hdc-cli imports in hdc-clumps to stable hdc/cli/* specifiers.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const hdcRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const clumpsRoot = join(hdcRoot, "..", "hdc-clumps");

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "node_modules" || name === ".git") continue;
      out.push(...walk(p));
    } else if (name.endsWith(".mjs") || name.endsWith(".json")) {
      out.push(p);
    }
  }
  return out;
}

const reFrom = /from ["'](?:\.\.\/)+apps\/hdc-cli\/([^"']+)["']/g;
const reImport = /import\(["'](?:\.\.\/)+apps\/hdc-cli\/([^"']+)["']\)/g;

let changed = 0;
for (const file of walk(clumpsRoot)) {
  let s = readFileSync(file, "utf8");
  const before = s;
  s = s.replace(reFrom, 'from "hdc/cli/$1"');
  s = s.replace(reImport, 'import("hdc/cli/$1")');
  if (s !== before) {
    writeFileSync(file, s, "utf8");
    changed++;
    console.error(file);
  }
}
console.error(`updated ${changed} files`);
