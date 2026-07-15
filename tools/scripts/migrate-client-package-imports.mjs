#!/usr/bin/env node
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const clientsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "apps", "hdc-cli", "lib", "package", "clients");

function walkMjs(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walkMjs(p));
    else if (name.endsWith(".mjs")) out.push(p);
  }
  return out;
}

for (const file of walkMjs(clientsDir)) {
  let s = readFileSync(file, "utf8");
  const before = s;
  s = s.replace(/from ["']\.\.\/\.\.\/lib\//g, 'from "../');
  s = s.replace(/from ["']\.\.\/\.\.\/services\//g, 'from "hdc/clump/services/');
  s = s.replace(/from ["']\.\.\/\.\.\/\.\.\/paths\.mjs["']/g, 'from "../../paths.mjs"');
  s = s.replace(/import\(["']\.\.\/\.\.\/\.\.\/apps\/hdc-cli\/lib\//g, "import('../../");
  if (s !== before) {
    writeFileSync(file, s, "utf8");
    console.error(`fixed ${file}`);
  }
}
