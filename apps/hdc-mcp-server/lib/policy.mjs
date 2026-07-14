import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/** @typedef {'client' | 'infrastructure' | 'service'} AllowedTier */

/** @typedef {'hdc_list' | 'hdc_help' | 'hdc_maintain_daily' | 'hdc_run' | 'hdc_notify_discord'} McpToolName */

/** Default profile when HDC_AGENT_ROLE is unset (IDE / run-daily). */
export const DEFAULT_AGENT_ROLE = "default";

/** @type {ReadonlySet<string>} */
export const ALLOWED_RUN_VERBS = new Set(["query", "health", "maintain"]);

/** @type {ReadonlySet<string>} */
export const BLOCKED_TOP_LEVEL_COMMANDS = new Set([
  "secrets",
  "deploy",
  "teardown",
  "users",
]);

/**
 * Per-role MCP surface. Omit role → default (safe global profile).
 * @type {Readonly<Record<string, {
 *   tools: ReadonlySet<McpToolName>,
 *   runVerbs: ReadonlySet<string>,
 *   allowDeployWithApprovedTask?: boolean,
 * }>>}
 */
export const ROLE_POLICIES = Object.freeze({
  [DEFAULT_AGENT_ROLE]: {
    tools: new Set([
      "hdc_list",
      "hdc_help",
      "hdc_maintain_daily",
      "hdc_run",
      "hdc_notify_discord",
    ]),
    runVerbs: new Set(["query", "health", "maintain"]),
  },
  "hdc-manager": {
    tools: new Set([
      "hdc_list",
      "hdc_help",
      "hdc_maintain_daily",
      "hdc_run",
      "hdc_notify_discord",
    ]),
    runVerbs: new Set(["query", "health", "maintain", "deploy"]),
    allowDeployWithApprovedTask: true,
  },
  "hdc-sre": {
    tools: new Set(["hdc_list", "hdc_help", "hdc_run", "hdc_notify_discord"]),
    runVerbs: new Set(["query", "health", "maintain", "deploy"]),
    allowDeployWithApprovedTask: true,
  },
  "hdc-monitor": {
    tools: new Set(["hdc_list", "hdc_help", "hdc_run", "hdc_notify_discord"]),
    runVerbs: new Set(["query", "health"]),
  },
  "hdc-security-expert": {
    tools: new Set(["hdc_list", "hdc_help", "hdc_run", "hdc_notify_discord"]),
    runVerbs: new Set(["query", "health", "maintain"]),
  },
  "hdc-security-architect": {
    tools: new Set(["hdc_list", "hdc_help", "hdc_run"]),
    runVerbs: new Set(["query", "health"]),
  },
  "hdc-network-architect": {
    tools: new Set(["hdc_list", "hdc_help", "hdc_run"]),
    runVerbs: new Set(["query", "health"]),
  },
  "hdc-research": {
    tools: new Set(["hdc_list", "hdc_help", "hdc_run"]),
    runVerbs: new Set(["query", "health"]),
  },
  "hdc-engineer": {
    tools: new Set(["hdc_list", "hdc_help", "hdc_run"]),
    runVerbs: new Set(["query", "health"]),
  },
  "hdc-scheduler": {
    tools: new Set([
      "hdc_list",
      "hdc_help",
      "hdc_maintain_daily",
      "hdc_run",
      "hdc_notify_discord",
    ]),
    runVerbs: new Set(["query", "health", "maintain"]),
  },
});

/**
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 * @returns {string}
 */
export function resolveAgentRole(env = process.env) {
  const raw = String(env.HDC_AGENT_ROLE ?? "").trim();
  if (!raw) return DEFAULT_AGENT_ROLE;
  return raw;
}

/**
 * @param {string} [role]
 */
export function getRolePolicy(role) {
  const r = String(role ?? DEFAULT_AGENT_ROLE).trim() || DEFAULT_AGENT_ROLE;
  const policy = ROLE_POLICIES[r];
  if (!policy) {
    throw new Error(
      `unknown HDC_AGENT_ROLE ${JSON.stringify(r)} (known: ${Object.keys(ROLE_POLICIES).join(", ")})`,
    );
  }
  return policy;
}

/**
 * @param {string} toolName
 * @param {string} [role]
 */
export function assertToolAllowedForRole(toolName, role = resolveAgentRole()) {
  const policy = getRolePolicy(role);
  const name = /** @type {McpToolName} */ (String(toolName));
  if (!policy.tools.has(name)) {
    throw new Error(
      `tool ${JSON.stringify(toolName)} is not allowed for role ${JSON.stringify(role)}`,
    );
  }
}

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
 * @param {string} [role]
 */
export function assertAllowedRunVerb(verb, role = resolveAgentRole()) {
  const v = String(verb ?? "").trim().toLowerCase();
  const policy = getRolePolicy(role);
  if (!policy.runVerbs.has(v)) {
    throw new Error(
      `verb ${JSON.stringify(verb)} is not allowed via MCP for role ${JSON.stringify(role)} (allowed: ${[...policy.runVerbs].join(", ")})`,
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

/**
 * Parse YAML-ish frontmatter `status:` from a task markdown file.
 * @param {string} content
 * @returns {string | null}
 */
export function parseTaskFrontmatterStatus(content) {
  const text = String(content ?? "");
  if (!text.startsWith("---")) return null;
  const end = text.indexOf("\n---", 3);
  if (end < 0) return null;
  const fm = text.slice(3, end);
  const m = fm.match(/^\s*status:\s*["']?([a-z_]+)["']?\s*$/im);
  return m ? m[1].toLowerCase() : null;
}

/**
 * Require task_id with status approved when verb is deploy (or when role demands it).
 * @param {{
 *   verb: string,
 *   taskId?: string | null,
 *   role?: string,
 *   privateRoot?: string | null,
 *   readFile?: (p: string) => string,
 *   exists?: (p: string) => boolean,
 * }} opts
 */
export function assertApprovedTaskForDeploy(opts) {
  const role = opts.role ?? resolveAgentRole();
  const policy = getRolePolicy(role);
  const verb = String(opts.verb ?? "").trim().toLowerCase();
  if (verb !== "deploy") return;
  if (!policy.allowDeployWithApprovedTask) {
    throw new Error(`deploy is not allowed for role ${JSON.stringify(role)}`);
  }
  const taskId = String(opts.taskId ?? "").trim();
  if (!taskId) {
    throw new Error("deploy via MCP requires task_id of an approved operations/tasks/<id>.md");
  }
  const root = opts.privateRoot ? String(opts.privateRoot) : "";
  if (!root) {
    throw new Error("deploy via MCP requires HDC_PRIVATE_ROOT (or resolved private root) to verify task status");
  }
  const taskPath = path.join(root, "operations", "tasks", `${taskId}.md`);
  const exists = opts.exists ?? ((p) => existsSync(p));
  const readFile = opts.readFile ?? ((p) => readFileSync(p, "utf8"));
  if (!exists(taskPath)) {
    throw new Error(`task file not found: ${taskPath}`);
  }
  const status = parseTaskFrontmatterStatus(readFile(taskPath));
  if (status !== "approved") {
    throw new Error(
      `task ${JSON.stringify(taskId)} status is ${JSON.stringify(status)} (required: approved)`,
    );
  }
}
