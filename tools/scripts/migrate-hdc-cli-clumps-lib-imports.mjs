#!/usr/bin/env node
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** @param {string} dir */
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "node_modules" || name === ".git") continue;
      out.push(...walk(p));
    } else if (name.endsWith(".mjs")) out.push(p);
  }
  return out;
}

for (const file of walk(join(root, "apps"))) {
  let s = readFileSync(file, "utf8");
  const b = s;
  s = s.replace(/from ["'](\.\.\/)+clumps\/lib\/([^"']+)["']/g, 'from "hdc/package/$2"');
  s = s.replace(/import\(["'](\.\.\/)+clumps\/lib\/([^"']+)["']\)/g, 'import("hdc/package/$2")');
  s = s.replace(/from ["'](\.\.\/)+clumps\/clients\/lib\/([^"']+)["']/g, 'from "hdc/package/clients/$2"');
  if (s !== b) {
    writeFileSync(file, s, "utf8");
    console.error(file);
  }
}
