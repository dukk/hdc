/**
 * Scoped MCP API keys: opaque secrets mapped to ROLE_POLICIES roles.
 * Plaintext in vault only; SHA-256 hashes in hdc-private operations/mcp-api-keys.json.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { getRolePolicy } from "./policy.mjs";

const KEY_PREFIX = "hdcmcp_";
const REGISTRY_REL = path.join("operations", "mcp-api-keys.json");

/**
 * @param {string} role
 * @returns {string}
 */
export function mcpApiKeyVaultKey(role) {
  const r = String(role ?? "").trim() || "default";
  return `HDC_MCP_API_KEY_${r.replace(/-/g, "_").toUpperCase()}`;
}

/**
 * @returns {string}
 */
export function mintMcpApiKeySecret() {
  return `${KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
}

/**
 * @param {string} secret
 * @returns {string} hex sha256
 */
export function hashMcpApiKey(secret) {
  return createHash("sha256").update(String(secret), "utf8").digest("hex");
}

/**
 * @param {string} a
 * @param {string} b
 */
function safeEqualHex(a, b) {
  const aa = Buffer.from(String(a), "utf8");
  const bb = Buffer.from(String(b), "utf8");
  if (aa.length !== bb.length) return false;
  return timingSafeEqual(aa, bb);
}

/**
 * @param {string} role
 */
export function scopesFromRole(role) {
  const policy = getRolePolicy(role);
  return {
    tools: [...policy.tools].sort(),
    runVerbs: [...policy.runVerbs].sort(),
    allowDeployWithApprovedTask: Boolean(policy.allowDeployWithApprovedTask),
  };
}

/**
 * @param {string} privateRoot
 * @returns {string}
 */
export function mcpApiKeyRegistryPath(privateRoot) {
  return path.join(String(privateRoot), REGISTRY_REL);
}

/**
 * @typedef {{
 *   version: number,
 *   keys: Array<{
 *     id: string,
 *     role: string,
 *     key_hash: string,
 *     scopes: ReturnType<typeof scopesFromRole>,
 *     label?: string,
 *     created_at: string,
 *   }>,
 * }} McpApiKeyRegistry
 */

/**
 * @param {string} privateRoot
 * @returns {McpApiKeyRegistry}
 */
export function loadMcpApiKeyRegistry(privateRoot) {
  const p = mcpApiKeyRegistryPath(privateRoot);
  if (!existsSync(p)) {
    return { version: 1, keys: [] };
  }
  const raw = JSON.parse(readFileSync(p, "utf8"));
  return {
    version: Number(raw.version) || 1,
    keys: Array.isArray(raw.keys) ? raw.keys : [],
  };
}

/**
 * @param {string} privateRoot
 * @param {McpApiKeyRegistry} registry
 */
export function saveMcpApiKeyRegistry(privateRoot, registry) {
  const p = mcpApiKeyRegistryPath(privateRoot);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
}

/**
 * Upsert registry entry by role (one active hashed key per role).
 * @param {string} privateRoot
 * @param {{ role: string, secret: string, label?: string, id?: string }} opts
 */
export function registerMcpApiKeyHash(privateRoot, opts) {
  const role = String(opts.role).trim();
  getRolePolicy(role);
  const registry = loadMcpApiKeyRegistry(privateRoot);
  const keyHash = hashMcpApiKey(opts.secret);
  const scopes = scopesFromRole(role);
  const id = opts.id || `mcp-${role}`;
  const created_at = new Date().toISOString();
  const entry = {
    id,
    role,
    key_hash: keyHash,
    scopes,
    label: opts.label || role,
    created_at,
  };
  const idx = registry.keys.findIndex((k) => k.role === role);
  if (idx >= 0) {
    entry.created_at = registry.keys[idx].created_at || created_at;
    registry.keys[idx] = entry;
  } else {
    registry.keys.push(entry);
  }
  saveMcpApiKeyRegistry(privateRoot, registry);
  return entry;
}

/**
 * Look up role/policy from a plaintext API key against the registry.
 * @param {string} secret
 * @param {string} privateRoot
 * @returns {{ role: string, policy: ReturnType<typeof getRolePolicy>, entry: object } | null}
 */
export function resolveMcpApiKey(secret, privateRoot) {
  const raw = String(secret ?? "").trim();
  if (!raw || !privateRoot) return null;
  const want = hashMcpApiKey(raw);
  const registry = loadMcpApiKeyRegistry(privateRoot);
  for (const entry of registry.keys) {
    if (entry.key_hash && safeEqualHex(entry.key_hash, want)) {
      const role = String(entry.role);
      return { role, policy: getRolePolicy(role), entry };
    }
  }
  return null;
}

/**
 * Whether fleet containers must present a valid API key.
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 */
export function mcpApiKeyRequired(env = process.env) {
  const v = String(env.HDC_MCP_REQUIRE_API_KEY ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/**
 * Resolve effective agent role from API key (preferred) or HDC_AGENT_ROLE.
 * @param {{
 *   env?: NodeJS.ProcessEnv | Record<string, string | undefined>,
 *   privateRoot?: string | null,
 *   apiKey?: string | null,
 *   resolveRole?: (env: object) => string,
 * }} [opts]
 * @returns {{ role: string, via: 'api_key' | 'env_role' }}
 */
export function resolveMcpAuth(opts = {}) {
  const env = opts.env ?? process.env;
  const privateRoot = opts.privateRoot ? String(opts.privateRoot) : "";
  const apiKey =
    (opts.apiKey != null ? String(opts.apiKey) : "") ||
    String(env.HDC_MCP_API_KEY ?? "").trim();

  if (apiKey) {
    if (!privateRoot) {
      throw new Error("HDC_MCP_API_KEY set but private root is missing (HDC_PRIVATE_ROOT)");
    }
    const hit = resolveMcpApiKey(apiKey, privateRoot);
    if (!hit) {
      throw new Error("invalid HDC_MCP_API_KEY (not found in operations/mcp-api-keys.json)");
    }
    return { role: hit.role, via: "api_key" };
  }

  if (mcpApiKeyRequired(env)) {
    throw new Error("HDC_MCP_API_KEY is required (HDC_MCP_REQUIRE_API_KEY=1)");
  }

  const resolveRole =
    opts.resolveRole ??
    ((e) => {
      const raw = String(e.HDC_AGENT_ROLE ?? "").trim();
      return raw || "default";
    });
  return { role: resolveRole(env), via: "env_role" };
}
