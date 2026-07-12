#!/usr/bin/env node
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const skip = new Set(["node_modules", ".git", "coverage"]);

const REPS = [
  ["packageId:", "clumpId:"],
  ["packageTitle:", "clumpTitle:"],
  ["t.packageId", "t.clumpId"],
  ['join(publicRoot, "packages"', 'join(publicRoot, "clumps"'],
  ['join(privateRoot, "packages"', 'join(privateRoot, "clumps"'],
  ['join(root, "packages"', 'join(root, "clumps"'],
  ['"packages/infrastructure/', '"clumps/infrastructure/'],
  ['"packages/services/', '"clumps/services/'],
  ['"packages/clients/', '"clumps/clients/'],
];

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    if (skip.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith(".mjs")) out.push(p);
  }
}

/** @type {string[]} */
const files = [];
for (const sub of ["apps/hdc-cli", "clumps"]) {
  walk(join(root, sub), files);
}

let n = 0;
for (const file of files) {
  if (file.includes("rename-packages-to-clumps") || file.includes("fix-test-paths")) continue;
  let text = readFileSync(file, "utf8");
  const before = text;
  for (const [from, to] of REPS) {
    text = text.split(from).join(to);
  }
  if (text !== before) {
    writeFileSync(file, text, "utf8");
    n++;
  }
}
console.error(`fixed ${n} files`);
