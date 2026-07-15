#!/usr/bin/env node
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "node_modules") continue;
      out.push(...walk(p));
    } else if (name.endsWith(".mjs")) out.push(p);
  }
  return out;
}

for (const file of walk(join(root, "apps"))) {
  let s = readFileSync(file, "utf8");
  const b = s;
  s = s.replace(/from ["'](\.\.\/)+clumps\/([^"']+)["']/g, 'from "hdc/clump/$2"');
  s = s.replace(/import\(["'](\.\.\/)+clumps\/([^"']+)["']\)/g, 'import("hdc/clump/$2")');
  s = s.replace(/join\([^)]*clumps\/services\//g, (m) => m.replace("clumps/", "hdc/clump/"));
  if (s !== b) {
    writeFileSync(file, s, "utf8");
    console.error(file);
  }
}

for (const file of walk(join(root, "tools"))) {
  let s = readFileSync(file, "utf8");
  const b = s;
  s = s.replace(/from ["'](\.\.\/)+clumps\/([^"']+)["']/g, 'from "hdc/clump/$2"');
  if (s !== b) {
    writeFileSync(file, s, "utf8");
    console.error(file);
  }
}
