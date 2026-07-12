/** @typedef {'client' | 'infrastructure' | 'service'} AllowedTier */

/** @type {ReadonlySet<string>} */
export const ALLOWED_RUN_VERBS = new Set(["query", "maintain"]);

/** @type {ReadonlySet<string>} */
export const BLOCKED_TOP_LEVEL_COMMANDS = new Set([
  "secrets",
  "deploy",
  "teardown",
  "users",
]);

/**
 * @param {string} tier
 * @returns {AllowedTier}
 */
export function normalizeTier(tier) {
  const t = String(tier ?? "").trim().toLowerCase();
  if (t === "infra") return "infrastructure";
  if (t === "client" || t === "infrastructure" || t === "service") {
    return /** @type {AllowedTier} */ (t);
  }
  throw new Error(`invalid tier ${JSON.stringify(tier)} (use client, infrastructure, or service)`);
}

/**
 * @param {string} verb
 */
export function assertAllowedRunVerb(verb) {
  const v = String(verb ?? "").trim().toLowerCase();
  if (!ALLOWED_RUN_VERBS.has(v)) {
    throw new Error(
      `verb ${JSON.stringify(verb)} is not allowed via MCP (allowed: ${[...ALLOWED_RUN_VERBS].join(", ")})`,
    );
  }
  return v;
}

/**
 * @param {string} command
 */
export function assertNotBlockedCommand(command) {
  const c = String(command ?? "").trim().toLowerCase();
  if (BLOCKED_TOP_LEVEL_COMMANDS.has(c)) {
    throw new Error(`command ${JSON.stringify(command)} is not allowed via MCP`);
  }
}

/**
 * @param {string[]} extraArgs
 */
export function assertNoDestructiveRunFlags(extraArgs) {
  const blocked = new Set(["--prune", "--destroy-existing", "--reboot", "--rolling-restart"]);
  for (const arg of extraArgs) {
    const a = String(arg).trim().toLowerCase();
    if (blocked.has(a)) {
      throw new Error(`flag ${JSON.stringify(arg)} is not allowed via MCP`);
    }
  }
}
