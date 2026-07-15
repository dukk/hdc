/**
 * Shared augmentor delegation allowlists (MCP + delegate-augment).
 */

/** @type {ReadonlySet<string>} */
export const AUGMENT_DELEGATOR_ROLES = new Set([
  "hdc-engineer",
  "hdc-sre-engineer",
  "hdc-qa",
  "hdc-research",
  "hdc-security-expert",
  "hdc-security-architect",
  "hdc-network-architect",
]);

/** @type {Readonly<Record<string, readonly string[]>>} */
export const REPOS_BY_ROLE = Object.freeze({
  "hdc-engineer": Object.freeze(["hdc"]),
  "hdc-sre-engineer": Object.freeze(["hdc-clumps"]),
  "hdc-qa": Object.freeze(["hdc-clumps", "hdc"]),
  "hdc-research": Object.freeze(["hdc", "hdc-clumps"]),
  "hdc-security-expert": Object.freeze(["hdc-clumps"]),
  "hdc-security-architect": Object.freeze(["hdc-clumps", "hdc"]),
  "hdc-network-architect": Object.freeze(["hdc-clumps"]),
});

/**
 * @param {string} role
 * @returns {string}
 */
export function defaultRepoForRole(role) {
  const list = REPOS_BY_ROLE[role];
  return list?.[0] ?? "";
}

/**
 * @param {string} role
 * @param {string} repo
 */
export function assertRepoAllowedForRole(role, repo) {
  const allowed = REPOS_BY_ROLE[role];
  if (!allowed) {
    throw new Error(`role ${JSON.stringify(role)} may not delegate to augmentors`);
  }
  if (repo !== "hdc" && repo !== "hdc-clumps") {
    throw new Error(`repo must be "hdc" or "hdc-clumps" (got ${JSON.stringify(repo)})`);
  }
  if (!allowed.includes(repo)) {
    throw new Error(
      `${role} may only delegate repos [${allowed.join(", ")}] (got ${JSON.stringify(repo)})`,
    );
  }
}
