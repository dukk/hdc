/**
 * Shared A2A agent registry metadata (litellm.a2a_agents[] ↔ agent cards).
 */

/** @typedef {"fleet" | "augmentor"} A2aAgentKind */
/** @typedef {"cursor-cloud" | "cursor-cli" | "claude-code" | "custom"} A2aAgentRuntime */
/** @typedef {"hdc-clumps"} A2aAgentRepo */

const TAG_PREFIX = "[hdc-a2a";

/**
 * @param {unknown} agent
 * @returns {string}
 */
export function defaultA2aAgentKind(agent) {
  if (agent && typeof agent === "object") {
    const o = /** @type {Record<string, unknown>} */ (agent);
    if (typeof o.kind === "string" && o.kind.trim()) return o.kind.trim();
    const name = typeof o.name === "string" ? o.name.trim() : "";
    if (name.startsWith("hdc-")) return "fleet";
  }
  return "augmentor";
}

/**
 * @param {unknown} agent
 * @returns {string}
 */
export function formatA2aAgentDescription(agent) {
  if (!agent || typeof agent !== "object") return "A2A agent";
  const o = /** @type {Record<string, unknown>} */ (agent);
  const name = typeof o.name === "string" ? o.name.trim() : "agent";
  const base =
    typeof o.description === "string" && o.description.trim()
      ? o.description.trim().replace(/\s*\[hdc-a2a[^\]]*\]\s*$/i, "").trim()
      : `A2A agent ${name}`;
  /** @type {string[]} */
  const tags = [];
  const kind = defaultA2aAgentKind(o);
  tags.push(`kind=${kind}`);
  if (typeof o.runtime === "string" && o.runtime.trim()) {
    tags.push(`runtime=${o.runtime.trim()}`);
  }
  const repos = stringList(o.repos);
  if (repos.length) tags.push(`repos=${repos.join(",")}`);
  const delegatableBy = stringList(o.delegatable_by);
  if (delegatableBy.length) tags.push(`delegatable_by=${delegatableBy.join(",")}`);
  if (o.enabled === false) tags.push("enabled=false");
  return `${base} ${TAG_PREFIX} ${tags.join(" ")}]`;
}

/**
 * @param {unknown} v
 * @returns {string[]}
 */
function stringList(v) {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x).trim()).filter(Boolean);
}

/**
 * @param {string} description
 * @returns {Record<string, string>}
 */
export function parseA2aMetadataTags(description) {
  const text = String(description ?? "");
  const m = text.match(/\[hdc-a2a\s+([^\]]+)\]/i);
  if (!m) return {};
  /** @type {Record<string, string>} */
  const out = {};
  for (const part of m[1].split(/\s+/)) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    out[part.slice(0, eq)] = part.slice(eq + 1);
  }
  return out;
}

/**
 * @param {unknown} card
 * @param {unknown} [configEntry]
 */
export function parseAugmentorMetadata(card, configEntry = null) {
  const desc =
    card && typeof card === "object" && typeof /** @type {Record<string, unknown>} */ (card).description === "string"
      ? /** @type {Record<string, unknown>} */ (card).description
      : "";
  const tags = parseA2aMetadataTags(desc);
  const cfg = configEntry && typeof configEntry === "object" ? /** @type {Record<string, unknown>} */ (configEntry) : {};

  const kind = String(tags.kind || cfg.kind || defaultA2aAgentKind(cfg)).trim();
  const runtime = String(tags.runtime || cfg.runtime || "").trim() || undefined;
  const reposRaw = tags.repos || (Array.isArray(cfg.repos) ? cfg.repos.join(",") : "");
  const repos = reposRaw
    ? reposRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : stringList(cfg.repos);
  const delegRaw =
    tags.delegatable_by || (Array.isArray(cfg.delegatable_by) ? cfg.delegatable_by.join(",") : "");
  const delegatable_by = delegRaw
    ? delegRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : stringList(cfg.delegatable_by);
  const enabled =
    tags.enabled === "false" || cfg.enabled === false ? false : cfg.enabled !== false;

  return { kind, runtime, repos, delegatable_by, enabled };
}

/**
 * @param {unknown} entry
 * @param {{ delegatorRole?: string, repo?: string }} criteria
 */
export function matchesAugmentorCriteria(entry, criteria) {
  const meta = parseAugmentorMetadata(null, entry);
  if (meta.kind !== "augmentor") return false;
  if (!meta.enabled) return false;
  // Fleet agents may only augment hdc-clumps (never the hdc platform repo).
  if (criteria.repo && criteria.repo !== "hdc-clumps") return false;
  if (criteria.delegatorRole && meta.delegatable_by.length) {
    if (!meta.delegatable_by.includes(criteria.delegatorRole)) return false;
  }
  if (criteria.repo && meta.repos.length) {
    if (!meta.repos.includes(criteria.repo)) return false;
  }
  return true;
}
