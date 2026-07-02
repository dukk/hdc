import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { TASK_ROLES, updateTaskStatus } from "./hdc-runner-tasks.mjs";

const READONLY_ROLES = new Set([
  "hdc-security-architect",
  "hdc-network-architect",
  "hdc-research",
]);

/**
 * @param {string} installRoot
 * @param {string} role
 */
export function agentDefinitionPath(installRoot, role) {
  if (!TASK_ROLES.includes(/** @type {import("./hdc-runner-tasks.mjs").TaskRole} */ (role))) {
    throw new Error(`unknown agent role: ${role}`);
  }
  return join(installRoot, ".cursor", "agents", `${role}.md`);
}

/**
 * @param {string} installRoot
 * @param {string} role
 */
export function agentSkillPath(installRoot, role) {
  const skillMap = {
    "hdc-manager": "hdc-manager",
    "hdc-monitor": "hdc-monitor",
    "hdc-sre": "hdc-ops",
    "hdc-security-expert": "hdc-security",
    "hdc-security-architect": "hdc-security",
    "hdc-network-architect": "hdc-agent-team",
    "hdc-research": "hdc-agent-team",
  };
  const skill = skillMap[/** @type {keyof typeof skillMap} */ (role)] ?? "hdc-agent-team";
  return join(installRoot, ".cursor", "skills", skill, "SKILL.md");
}

/**
 * @param {object} opts
 * @param {string} opts.installRoot
 * @param {string} opts.privateRoot
 * @param {string} opts.role
 * @param {string} [opts.taskId]
 * @param {string} [opts.instructions]
 */
export function buildAgentPrompt(opts) {
  const agentPath = agentDefinitionPath(opts.installRoot, opts.role);
  const skillPath = agentSkillPath(opts.installRoot, opts.role);
  const teamSkill = join(opts.installRoot, ".cursor", "skills", "hdc-agent-team", "SKILL.md");
  const delegation = join(opts.privateRoot, "operations", "delegation-policy.md");

  /** @type {string[]} */
  const parts = [
    `You are the ${opts.role} agent for the HDC home data center.`,
    `Read and follow these files first:`,
    `- ${agentPath}`,
    `- ${skillPath}`,
    `- ${teamSkill}`,
    `- ${delegation}`,
    `Task files live under ${opts.privateRoot}/operations/tasks/ as individual .md files with YAML frontmatter.`,
    `Update task status in frontmatter when work completes. Regenerate ${opts.privateRoot}/operations/task-report.md when you change tasks.`,
    `Never invent hostnames, IPs, or credentials. Use node tools/hdc/cli.mjs from ${opts.installRoot}.`,
  ];

  if (opts.taskId) {
    parts.push(
      `Execute task file: ${opts.privateRoot}/operations/tasks/${opts.taskId}.md`,
      `Set status to in_progress when starting, done when complete, or blocked with blocked_reason if stuck.`,
    );
  }

  if (opts.instructions) {
    parts.push("", opts.instructions);
  }

  return parts.join("\n");
}

/**
 * @param {string} role
 */
export function agentCliMode(role) {
  return READONLY_ROLES.has(role) ? "plan" : "agent";
}

/**
 * @param {object} opts
 * @param {string} opts.workspace
 * @param {string} opts.apiKey
 * @param {string} opts.role
 * @param {string} opts.prompt
 * @param {string} [opts.logPath]
 */
export function runCursorAgent(opts) {
  const logPath = opts.logPath;
  if (logPath) {
    mkdirSync(join(logPath, ".."), { recursive: true });
    appendFileSync(logPath, `\n=== ${new Date().toISOString()} ${opts.role} ===\n${opts.prompt}\n\n`, "utf8");
  }

  /** @type {string[]} */
  const args = [
    "-p",
    "--force",
    "--workspace",
    opts.workspace,
    "--output-format",
    "json",
    "--mode",
    agentCliMode(opts.role),
    opts.prompt,
  ];

  const env = {
    ...process.env,
    CURSOR_API_KEY: opts.apiKey,
    PATH: `${process.env.HOME ?? ""}/.local/bin:/usr/local/bin:${process.env.PATH ?? ""}`,
  };

  const r = spawnSync("agent", args, {
    cwd: opts.workspace,
    encoding: "utf8",
    env,
    maxBuffer: 64 * 1024 * 1024,
    shell: false,
  });

  const stdout = r.stdout ?? "";
  const stderr = r.stderr ?? "";
  const exitCode = r.status ?? 1;

  if (logPath) {
    appendFileSync(
      logPath,
      `\n--- exit=${exitCode} ---\n${stderr}\n${stdout}\n`,
      "utf8",
    );
  }

  /** @type {Record<string, unknown> | null} */
  let parsed = null;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    parsed = null;
  }

  return {
    ok: exitCode === 0,
    exitCode,
    stdout,
    stderr,
    parsed,
    error: r.error?.message,
  };
}

/**
 * @param {object} opts
 * @param {string} opts.installRoot
 * @param {string} opts.privateRoot
 * @param {string} opts.apiKey
 * @param {string} opts.role
 * @param {string} opts.taskId
 */
export function runAgentForTask(opts) {
  const logPath = `/var/log/hdc-runner/agents/${opts.taskId}.log`;
  updateTaskStatus(opts.privateRoot, opts.taskId, {
    status: "in_progress",
    run_log: logPath,
  });

  const prompt = buildAgentPrompt({
    installRoot: opts.installRoot,
    privateRoot: opts.privateRoot,
    role: opts.role,
    taskId: opts.taskId,
  });

  const result = runCursorAgent({
    workspace: opts.installRoot,
    apiKey: opts.apiKey,
    role: opts.role,
    prompt,
    logPath,
  });

  if (result.ok) {
    try {
      updateTaskStatus(opts.privateRoot, opts.taskId, { status: "done" });
    } catch {
      /* agent may have updated status already */
    }
  }

  return result;
}

/**
 * Load manager triage automation instructions.
 *
 * @param {string} installRoot
 */
export function loadManagerTriageInstructions(installRoot) {
  const path = join(installRoot, ".cursor", "automations", "manager-triage.md");
  if (!existsSync(path)) {
    return [
      "Hourly manager triage:",
      "1. Scan operations/reports/ for new monitor, security, and research digests.",
      "2. Create or update task .md files under operations/tasks/ for actionable items.",
      "3. Set needs_decision and notify via Discord for operator decisions.",
      "4. Set status approved for work that may run autonomously per delegation-policy.md.",
      "5. Regenerate operations/task-report.md.",
    ].join("\n");
  }
  return readFileSync(path, "utf8");
}
