#!/usr/bin/env node
/**
 * Copy operator config + inventory to sibling hdc-private and remove from hdc (except templates).
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { repoRoot } from "../paths.mjs";
import { hdcPrivateRoot } from "../lib/private-repo.mjs";

const root = repoRoot();
const privateRoot = hdcPrivateRoot(root) ?? join(root, "..", "hdc-private");

if (!existsSync(privateRoot)) {
  mkdirSync(privateRoot, { recursive: true });
}

/**
 * @param {string} src
 * @param {string} dest
 */
function copyFileEnsureDir(src, dest) {
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
}

/**
 * @param {string} rootDir
 * @param {string} dir
 * @param {(rel: string, abs: string) => void} fn
 */
function walkFiles(rootDir, dir, fn) {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) walkFiles(rootDir, abs, fn);
    else fn(relative(rootDir, abs).replace(/\\/g, "/"), abs);
  }
}

/** @type {string[]} */
const copied = [];

// clump config.json (not example)
for (const base of ["clumps/infrastructure", "clumps/services", "clumps/clients"]) {
  const absBase = join(root, base);
  if (!existsSync(absBase)) continue;
  walkFiles(absBase, absBase, (rel, abs) => {
    if (!rel.endsWith("config.json")) return;
    if (rel.includes("config.example")) return;
    const dest = join(privateRoot, base, rel);
    copyFileEnsureDir(abs, dest);
    copied.push(join(base, rel).replace(/\\/g, "/"));
    rmSync(abs, { force: true });
  });
}

// inventory/manual/**/*.json except _example.json
const manualRoot = join(root, "inventory", "manual");
if (existsSync(manualRoot)) {
  walkFiles(manualRoot, manualRoot, (rel, abs) => {
    if (!rel.endsWith(".json")) return;
    if (rel.endsWith("_example.json")) return;
    const dest = join(privateRoot, "inventory", "manual", rel);
    copyFileEnsureDir(abs, dest);
    copied.push(`inventory/manual/${rel}`);
    rmSync(abs, { force: true });
  });
}

// inventory/automated
const autoRoot = join(root, "inventory", "automated");
if (existsSync(autoRoot)) {
  walkFiles(autoRoot, autoRoot, (rel, abs) => {
    const dest = join(privateRoot, "inventory", "automated", rel);
    copyFileEnsureDir(abs, dest);
    copied.push(`inventory/automated/${rel}`);
    rmSync(abs, { force: true });
  });
}

console.log(`Private root: ${privateRoot}`);
console.log(`Copied/moved ${copied.length} files`);
for (const c of copied.slice(0, 20)) console.log(`  ${c}`);
if (copied.length > 20) console.log(`  … and ${copied.length - 20} more`);
