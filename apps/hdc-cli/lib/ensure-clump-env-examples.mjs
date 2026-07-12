import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { ENV_KEY_TO_PACKAGE_ID } from "./env-key-clumps.mjs";

const PACKAGE_TIERS = ["infrastructure", "services", "clients"];

/**
 * @param {string} publicRoot
 * @returns {{ tier: string; id: string; rel: string; dir: string; title: string; envRequired: string[] }[]}
 */
export function discoverClumps(publicRoot) {
  /** @type {{ tier: string; id: string; rel: string; dir: string; title: string; envRequired: string[] }[]} */
  const out = [];
  for (const tier of PACKAGE_TIERS) {
    const tierDir = join(publicRoot, "clumps", tier);
    if (!existsSync(tierDir)) continue;
    for (const id of readdirSync(tierDir).sort((a, b) => a.localeCompare(b))) {
      const dir = join(tierDir, id);
      const manifestPath = join(dir, "manifest.json");
      if (!existsSync(manifestPath)) continue;
      let raw;
      try {
        raw = JSON.parse(readFileSync(manifestPath, "utf8"));
      } catch {
        continue;
      }
      const title =
        typeof raw.title === "string" && raw.title.trim() ? raw.title.trim() : id;
      const envRequired = Array.isArray(raw.env_required)
        ? raw.env_required.map(String).filter(Boolean)
        : [];
      const rel = `clumps/${tier}/${id}`.replace(/\\/g, "/");
      out.push({ tier, id, rel, dir, title, envRequired });
    }
  }
  return out;
}

/**
 * @param {string} clumpId
 */
export function envKeysForPackage(clumpId) {
  return Object.entries(ENV_KEY_TO_PACKAGE_ID)
    .filter(([, id]) => id === clumpId)
    .map(([key]) => key)
    .sort((a, b) => a.localeCompare(b));
}

/**
 * @param {{ rel: string; title: string; envRequired: string[] }} pkg
 * @param {string[]} mappedKeys
 */
export function renderPackageEnvExample(pkg, mappedKeys) {
  const keys = [...new Set([...pkg.envRequired, ...mappedKeys])].sort((a, b) =>
    a.localeCompare(b),
  );
  const lines = [
    `# Copy to ${pkg.rel}/.env in hdc-private (or hdc root; never commit).`,
    `# ${pkg.title} — values optional unless manifest env_required is set.`,
    `# Prefer vault: node apps/hdc-cli/cli.mjs secrets set <KEY>`,
    "",
  ];
  if (keys.length) {
    for (const key of keys) {
      lines.push(`# ${key}=`);
    }
  } else {
    lines.push("# No documented HDC_* env vars for this package (vault-only or config.json).");
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * @param {{ tier: string; id: string; rel: string }[]} packages
 */
export function renderPackageEnvIndex(packages) {
  const lines = [
    "",
    "# ── Package .env files (one per package; live values in hdc-private) ──",
    "# Copy each clumps/<tier>/<id>/.env.example → hdc-private/<same path>/.env",
    "# Loaded only when running that package (hdc run / maintain daily).",
    "",
  ];
  let lastTier = "";
  for (const pkg of packages) {
    if (pkg.tier !== lastTier) {
      lastTier = pkg.tier;
      lines.push(`# [${pkg.tier}]`);
    }
    lines.push(`#   ${pkg.rel}/.env.example`);
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * @param {string} publicRoot
 * @param {{ dryRun?: boolean; force?: boolean }} [opts]
 */
export function ensureAllPackageEnvExamples(publicRoot, opts = {}) {
  const dryRun = Boolean(opts.dryRun);
  const force = Boolean(opts.force);
  const packages = discoverClumps(publicRoot);

  /** @type {string[]} */
  const created = [];
  /** @type {string[]} */
  const skipped = [];

  for (const pkg of packages) {
    const dest = join(pkg.dir, ".env.example");
    if (existsSync(dest) && !force) {
      skipped.push(pkg.rel);
      continue;
    }
    const body = renderPackageEnvExample(pkg, envKeysForPackage(pkg.id));
    if (!dryRun) {
      mkdirSync(pkg.dir, { recursive: true });
      writeFileSync(dest, body, "utf8");
    }
    created.push(pkg.rel);
  }

  return { packages, created, skipped, dryRun };
}

/**
 * Refresh root `.env.example` global header + package index (preserves global variable lines).
 * @param {string} publicRoot
 * @param {{ dryRun?: boolean }} [opts]
 */
export function refreshRootEnvExampleIndex(publicRoot, opts = {}) {
  const dryRun = Boolean(opts.dryRun);
  const rootPath = join(publicRoot, ".env.example");
  const packages = discoverClumps(publicRoot);

  /** @type {string[]} */
  let globalLines = [];
  if (existsSync(rootPath)) {
    const text = readFileSync(rootPath, "utf8");
    const idx = text.indexOf("# ── Package .env files");
    globalLines = (idx >= 0 ? text.slice(0, idx) : text).trimEnd().split(/\r?\n/);
  } else {
    globalLines = [
      "# Copy to `.env` in the repo root (never commit `.env`).",
      "# Global HDC CLI: vault, secret backend, ops notifications, guest baseline.",
      "# Package-specific variables: clumps/<tier>/<id>/.env (see each .env.example).",
      "",
    ];
  }

  const body = `${globalLines.join("\n")}${renderPackageEnvIndex(packages)}`;
  if (!dryRun) {
    writeFileSync(rootPath, body.endsWith("\n") ? body : `${body}\n`, "utf8");
  }
  return { packageCount: packages.length, dryRun };
}
