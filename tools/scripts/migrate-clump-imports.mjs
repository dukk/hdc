#!/usr/bin/env node
/**
 * Rewrite clump script imports from relative ../../../lib/ to hdc/package/.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const clumpsDir = join(root, "clumps");

/** @param {string} dir */
function walkMjs(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "lib" && dir.replace(/\\/g, "/").endsWith("/clumps/lib")) continue;
      out.push(...walkMjs(p));
    } else if (name.endsWith(".mjs") && !name.endsWith(".test.mjs")) {
      out.push(p);
    }
  }
  return out;
}

/**
 * @param {string} content
 * @param {string} file
 * @returns {string}
 */
function rewrite(content, file) {
  let s = content;
  const norm = file.replace(/\\/g, "/");

  // Skip generated shims in clumps/lib
  if (norm.includes("/clumps/lib/") && s.includes("@deprecated Import from hdc/package")) {
    return content;
  }

  // Verb scripts and package lib: ../../../lib/foo -> hdc/package/foo
  s = s.replace(/from ["'](\.\.\/)+lib\/([^"']+)["']/g, 'from "hdc/package/$2"');

  // clients tier: ../../lib/foo from clients/*/maintain -> hdc/package/clients/foo or hdc/package/foo
  if (norm.includes("/clumps/clients/") && !norm.includes("/clumps/clients/lib/")) {
    s = s.replace(/from ["']hdc\/package\/client-/g, 'from "hdc/package/clients/client-');
  }

  // health scripts may use ../../../../lib
  s = s.replace(/from ["'](\.\.\/)+lib\/([^"']+)["']/g, 'from "hdc/package/$2"');

  // service-health subpath
  s = s.replace(/from ["']hdc\/package\/service-health\//g, 'from "hdc/package/service-health/');

  return s;
}

let changed = 0;
for (const file of walkMjs(clumpsDir)) {
  const before = readFileSync(file, "utf8");
  const after = rewrite(before, file);
  if (after !== before) {
    writeFileSync(file, after, "utf8");
    changed++;
    console.error(file);
  }
}
console.error(`updated ${changed} files`);
