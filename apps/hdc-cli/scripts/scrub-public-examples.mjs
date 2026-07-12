#!/usr/bin/env node
/**
 * One-shot anonymization for public hdc: RFC5737 IPs, example.invalid domains.
 * Run from repo root: node apps/hdc-cli/scripts/scrub-public-examples.mjs
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { repoRoot } from "../paths.mjs";

const root = repoRoot();

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "coverage",
  "backups",
]);

const TEXT_EXT = new Set([
  ".md",
  ".mdc",
  ".mjs",
  ".js",
  ".json",
  ".jsonc",
  ".yaml",
  ".yml",
  ".cmd",
  ".sh",
  ".example",
  ".toml",
  ".workspace",
]);

/** @type {Array<[RegExp, string]>} */
const REPLACEMENTS = [
  // Domains (longest / most specific first)
  [/\.hdc\.dukk\.org/gi, ".home.example.invalid"],
  [/\.dukk\.cloud/gi, ".example.invalid"],
  [/\.dukk\.org/gi, ".example.invalid"],
  [/\bdukk\.cloud\b/gi, "example.invalid"],
  [/\bdukk\.org\b/gi, "example.invalid"],
  [/@dukk\.cloud\b/gi, "@example.invalid"],
  [/@dukk\.org\b/gi, "@example.invalid"],
  [/\bdrippylit\.com\b/gi, "brand-a.example"],
  [/\btypotests\.com\b/gi, "brand-b.example"],
  [/\binfuzepartners\.com\b/gi, "partner.example"],
  [/\binfuzesocial\.com\b/gi, "social.example"],
  // Emails
  [/\bdukk@dukk\.org\b/gi, "ops@example.invalid"],
  [/\bdukk@dukk\.cloud\b/gi, "ops@example.invalid"],
  // Operator paths in comments
  [/C:\/dev\/dukk\/hdc-private/gi, "C:/path/to/hdc-private"],
  [/C:\\dev\\dukk\\hdc-private/gi, "C:/path/to/hdc-private"],
  // VLAN example in pi-hole readme
  [/10\.1\.0\.0\/24/g, "192.0.2.0/24"],
  // Site LAN hosts (after domain passes)
  [/10\.0\.0\.(\d+)/g, "192.0.2.$1"],
  // Real SSH test vector
  [
    /ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAII9fNnKJTlQpQa\+s10hzwZxHsM79rc1dTLUb0SRETKIx ops@example\.invalid/g,
    "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIG1vY2tUZXN0S2V5Rm9ySHZjRW5jb2RpbmcrdGVzdA== test@example.invalid",
  ],
];

/**
 * @param {string} dir
 * @param {(rel: string, abs: string) => void} fn
 */
function walk(dir, fn) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const abs = join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) {
      walk(abs, fn);
      continue;
    }
    const rel = relative(root, abs).replace(/\\/g, "/");
    if (rel === "apps/hdc-cli/scripts/scrub-public-examples.mjs") continue;
    const dot = name.lastIndexOf(".");
    const ext = dot >= 0 ? name.slice(dot) : "";
    if (!TEXT_EXT.has(ext) && !name.endsWith(".env.example") && name !== "hdc.code-workspace") {
      continue;
    }
    fn(rel, abs);
  }
}

/** @type {string[]} */
const changed = [];

walk(root, (rel, abs) => {
  let text = readFileSync(abs, "utf8");
  const before = text;
  for (const [re, rep] of REPLACEMENTS) {
    text = text.replace(re, rep);
  }
  if (text !== before) {
    writeFileSync(abs, text, "utf8");
    changed.push(rel);
  }
});

console.error(`Scrubbed ${changed.length} files`);
for (const f of changed.sort()) {
  console.error(`  ${f}`);
}
