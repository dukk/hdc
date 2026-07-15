#!/usr/bin/env node
/**
 * One-off: fix import paths after moving clumps/lib to apps/hdc-cli/lib/package/.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const packageDir = join(root, "apps", "hdc-cli", "lib", "package");

/** @param {string} dir */
function walkMjs(dir) {
  /** @type {string[]} */
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walkMjs(p));
    else if (name.endsWith(".mjs")) out.push(p);
  }
  return out;
}

/**
 * @param {string} content
 * @returns {string}
 */
function rewrite(content) {
  let s = content;
  // hdc-cli lib siblings (from lib/package/)
  s = s.replace(/from ["']\.\.\/\.\.\/apps\/hdc-cli\/lib\/([^"']+)["']/g, 'from "../$1"');
  s = s.replace(/from ["']\.\.\/\.\.\/\.\.\/apps\/hdc-cli\/lib\/([^"']+)["']/g, 'from "../../$1"');
  s = s.replace(/from ["']\.\.\/\.\.\/apps\/hdc-cli\/paths\.mjs["']/g, 'from "../../paths.mjs"');
  s = s.replace(/from ["']\.\.\/\.\.\/\.\.\/apps\/hdc-cli\/paths\.mjs["']/g, 'from "../../../paths.mjs"');
  s = s.replace(/from ["']\.\.\/\.\.\/apps\/hdc-cli\/vault\.mjs["']/g, 'from "../../vault.mjs"');
  // cross-clump imports
  s = s.replace(/from ["']\.\.\/infrastructure\//g, 'from "hdc/clump/infrastructure/');
  s = s.replace(/from ["']\.\.\/services\//g, 'from "hdc/clump/services/');
  return s;
}

for (const file of walkMjs(packageDir)) {
  const before = readFileSync(file, "utf8");
  const after = rewrite(before);
  if (after !== before) {
    writeFileSync(file, after, "utf8");
    console.error(`updated ${file}`);
  }
}
