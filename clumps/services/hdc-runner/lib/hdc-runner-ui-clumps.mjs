import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * @param {string} installRoot
 */
async function loadManifestTools(installRoot) {
  const manifestsPath = join(installRoot, "apps/hdc-cli/manifests.mjs");
  const pathsPath = join(installRoot, "apps/hdc-cli/paths.mjs");
  const m = await import(pathToFileURL(manifestsPath).href);
  const p = await import(pathToFileURL(pathsPath).href);
  return { ...m, clumpsDir: p.clumpsDir };
}

/**
 * @param {string} installRoot
 * @param {string[]} allowedVerbs
 */
export async function listClumpCatalog(installRoot, allowedVerbs) {
  const { discoverManifests, manifestId, manifestTitle, VERBS, clumpsDir } =
    await loadManifestTools(installRoot);

  const allowed = new Set(allowedVerbs.map((v) => v.toLowerCase()));
  const verbs = VERBS.filter((v) => allowed.has(v));
  const manifests = discoverManifests(clumpsDir(installRoot));
  /** @type {{ tier: string; id: string; title: string; verbs: string[] }[]} */
  const packages = [];

  for (const m of manifests) {
    const tierParts = m.dir.replace(/\\/g, "/").split("/");
    const pkgIdx = tierParts.indexOf("packages");
    const tierDir = pkgIdx >= 0 ? tierParts[pkgIdx + 1] : "";
    const tier =
      tierDir === "clients"
        ? "client"
        : tierDir === "infrastructure"
          ? "infrastructure"
          : tierDir === "services"
            ? "service"
            : null;
    if (!tier) continue;
    packages.push({
      tier,
      id: manifestId(m),
      title: manifestTitle(m),
      verbs: [...verbs],
    });
  }

  packages.sort((a, b) => a.id.localeCompare(b.id));
  return { packages, allowed_verbs: [...allowed] };
}

/**
 * @param {string} installRoot
 * @param {string} tier
 * @param {string} clumpId
 * @param {string} verb
 * @param {string[]} allowedVerbs
 */
export async function validatePackageRun(installRoot, tier, clumpId, verb, allowedVerbs) {
  const { manifestByTierAndId, discoverManifests, VERBS, clumpsDir } =
    await loadManifestTools(installRoot);

  const verbNorm = String(verb ?? "").trim().toLowerCase();
  if (!allowedVerbs.map((v) => v.toLowerCase()).includes(verbNorm)) {
    return { ok: false, error: `verb not allowed: ${verbNorm}` };
  }
  if (!VERBS.includes(/** @type {typeof VERBS[number]} */ (verbNorm))) {
    return { ok: false, error: `unknown verb: ${verbNorm}` };
  }

  const manifests = discoverManifests(clumpsDir(installRoot));
  const found = manifestByTierAndId(manifests, tier, clumpId);
  if (!found) {
    return { ok: false, error: `package not found: ${tier}/${clumpId}` };
  }
  return { ok: true, tier, package: clumpId, verb: verbNorm };
}

/**
 * @param {unknown} args
 */
export function normalizeCliArgs(args) {
  if (!Array.isArray(args)) return [];
  /** @type {string[]} */
  const out = [];
  for (const a of args) {
    const s = String(a);
    if (/[\0\r\n]/.test(s)) throw new Error("invalid character in argument");
    out.push(s);
  }
  return out;
}

/**
 * @param {string} raw
 */
export function parseArgsString(raw) {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return [];
  if (/[;&|`$<>]/.test(trimmed)) {
    throw new Error("shell metacharacters not allowed in arguments");
  }
  return trimmed.split(/\s+/).filter(Boolean);
}
