#!/usr/bin/env node
/**
 * Split root `.env.example` into global + per-clump `.env.example` files.
 * Regenerates apps/hdc-cli/lib/env-key-clumps.mjs.
 *
 * Usage: node apps/hdc-cli/scripts/split-env-example.mjs [--write]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  GLOBAL_ENV_KEYS,
  clumpIdFromRel,
  applyOrphanKeyHeuristics,
} from "../lib/env-example-split.mjs";
import {
  ensureAllPackageEnvExamples,
  refreshRootEnvExampleIndex,
} from "../lib/ensure-clump-env-examples.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const publicRoot = join(scriptDir, "../../..");

const PACKAGE_HEADER_RE = /clumps\/((?:infrastructure|services|clients)\/[a-z0-9-]+)/i;
const ENV_KEY_LINE_RE = /^\s*(?:export\s+)?(HDC_[A-Z0-9_]+)\s*=/;
const ENV_KEY_MENTION_RE = /\b(HDC_[A-Z0-9_]+)\b/g;

/**
 * @param {string} pkgId
 */
function inferPackageRel(pkgId) {
  for (const tier of ["infrastructure", "services", "clients"]) {
    if (existsSync(join(publicRoot, "clumps", tier, pkgId, "manifest.json"))) {
      return `${tier}/${pkgId}`;
    }
  }
  return `services/${pkgId}`;
}

/**
 * @param {string} text
 */
function splitLegacyEnvExample(text) {
  /** @type {string[]} */
  const globalOut = [
    "# Copy to `.env` in the repo root (never commit `.env`).",
    "# Global HDC CLI: vault, secret backend, ops notifications, guest baseline.",
    "# Package-specific variables: clumps/<tier>/<id>/.env (see each .env.example).",
    "",
  ];
  /** @type {Map<string, string[]>} */
  const packageSections = new Map();
  /** @type {Map<string, string>} */
  const keyToPackageId = new Map();

  /** @type {string | null} */
  let currentRel = null;
  /** @type {string | null} */
  let orphanRel = "infrastructure/proxmox";

  /**
   * @param {string} rel
   */
  function ensureSection(rel) {
    if (!packageSections.has(rel)) {
      packageSections.set(rel, [
        `# Copy to clumps/${rel}/.env in hdc-private (or hdc root; never commit).`,
        `# Values are optional unless the package manifest declares env_required.`,
        "",
      ]);
    }
    return packageSections.get(rel);
  }

  for (const line of text.split(/\r?\n/)) {
    const headerMatch = line.match(PACKAGE_HEADER_RE);
    if (headerMatch) {
      let rel = headerMatch[1].replace(/\\/g, "/").replace(/\/+$/, "");
      if (rel === "clients/client") rel = "clients/windows";
      currentRel = rel;
      orphanRel = null;
      ensureSection(currentRel).push(line);
      continue;
    }

    const keyMatch = line.match(ENV_KEY_LINE_RE);
    const key = keyMatch?.[1] ?? null;

    if (key && GLOBAL_ENV_KEYS.has(key)) {
      globalOut.push(line);
      continue;
    }

    if (currentRel) {
      ensureSection(currentRel).push(line);
      if (key) {
        const id = clumpIdFromRel(currentRel);
        if (id) keyToPackageId.set(key, id);
      }
      for (const m of line.matchAll(ENV_KEY_MENTION_RE)) {
        const k = m[1];
        if (!GLOBAL_ENV_KEYS.has(k)) {
          const id = clumpIdFromRel(currentRel);
          if (id && !keyToPackageId.has(k)) keyToPackageId.set(k, id);
        }
      }
      continue;
    }

    if (orphanRel && /proxmox|homepage|HDC_PROXMOX|HDC_NAGIOS|HDC_HOMEPAGE|HDC_UNIFI_NETWORK|HDC_IMMICH_API_KEY/i.test(line)) {
      ensureSection(orphanRel).push(line);
      if (key) keyToPackageId.set(key, "proxmox");
      for (const m of line.matchAll(ENV_KEY_MENTION_RE)) {
        if (!GLOBAL_ENV_KEYS.has(m[1]) && !keyToPackageId.has(m[1])) {
          if (m[1].startsWith("HDC_UNIFI_")) keyToPackageId.set(m[1], "unifi-network");
          else if (m[1] === "HDC_IMMICH_API_KEY") keyToPackageId.set(m[1], "immich");
          else keyToPackageId.set(m[1], "proxmox");
        }
      }
      continue;
    }

    if (key) {
      globalOut.push(line);
    } else if (
      /HDC_PRIVATE_ROOT|HDC_VAULT|HDC_SECRET_BACKEND|HDC_BW_EXECUTABLE|HDC_TLS_INSECURE|HDC_OPS_DISCORD|HDC_ADMIN_USER|HDC_GUEST_SSH_USER|vault\.enc|hdc-private|Secret backend|Passphrase|Discord webhook|Local sudo admin|Default SSH user for Proxmox Ubuntu guests/i.test(
        line,
      )
    ) {
      globalOut.push(line);
    }
  }

  applyOrphanKeyHeuristics(keyToPackageId);
  return { globalOut, packageSections, keyToPackageId };
}

/**
 * @param {Map<string, string>} keyToPackageId
 */
function writeEnvKeyPackages(keyToPackageId) {
  const entries = [...keyToPackageId.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const lines = [
    "/** Auto-generated from .env.example by split-env-example.mjs — do not edit by hand. */",
    "/** @type {Readonly<Record<string, string>>} */",
    "export const ENV_KEY_TO_PACKAGE_ID = {",
    ...entries.map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`),
    "};",
    "",
  ];
  writeFileSync(join(publicRoot, "apps/hdc-cli/lib/env-key-clumps.mjs"), lines.join("\n"), "utf8");
}

function main() {
  const write = process.argv.includes("--write");
  const legacyPath = join(publicRoot, ".env.example");
  if (!existsSync(legacyPath)) {
    console.error(".env.example not found");
    process.exit(1);
  }
  const text = readFileSync(legacyPath, "utf8");
  const { globalOut, packageSections, keyToPackageId } = splitLegacyEnvExample(text);

  console.error(`Global lines: ${globalOut.length}`);
  console.error(`Package sections: ${packageSections.size}`);
  console.error(`Env key map: ${keyToPackageId.size}`);

  if (!write) {
    console.error("Dry run — pass --write to update files");
    return;
  }

  writeFileSync(legacyPath, `${globalOut.join("\n").trimEnd()}\n`, "utf8");
  for (const [rel, lines] of packageSections) {
    const dest = join(publicRoot, "clumps", rel, ".env.example");
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, `${lines.join("\n").trimEnd()}\n`, "utf8");
    console.error(`wrote clumps/${rel}/.env.example`);
  }
  writeEnvKeyPackages(keyToPackageId);
  console.error("wrote apps/hdc-cli/lib/env-key-clumps.mjs");

  const ensured = ensureAllPackageEnvExamples(publicRoot, { dryRun: false, force: false });
  refreshRootEnvExampleIndex(publicRoot, { dryRun: false });
  console.error(
    `ensured package .env.example (${ensured.created.length} new, ${ensured.skipped.length} existing)`,
  );
}

main();
