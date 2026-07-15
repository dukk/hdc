import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { listTasks, writeTaskReport } from "./operations-fs.mjs";
import { listQueuedTopics } from "./research-topics.mjs";
import { notifyDiscordDecision } from "./notify-agents-discord.mjs";
import { processManagerMailbox } from "./manager-mailbox.mjs";

export { notifyDiscordDecision };

/**
 * @param {string} hdcRoot
 * @param {string[]} args after cli.mjs
 */
export function runHdcCliCapture(hdcRoot, args) {
  const cli = join(hdcRoot, "apps", "hdc-cli", "cli.mjs");
  if (!existsSync(cli)) return { ok: false, stdout: "", stderr: "cli missing" };
  const r = spawnSync(process.execPath, [cli, ...args], {
    cwd: hdcRoot,
    encoding: "utf8",
    timeout: 180_000,
    env: process.env,
  });
  return {
    ok: r.status === 0,
    status: r.status,
    stdout: String(r.stdout ?? ""),
    stderr: String(r.stderr ?? "").slice(0, 2000),
  };
}

/**
 * @param {string} text
 */
export function sha256Hex(text) {
  return createHash("sha256").update(String(text ?? "")).digest("hex");
}

/**
 * Tasks the manager may auto-run without operator approval (query-only suggestions
 * or approved UniFi IP-block maintain).
 *
 * @param {ReturnType<typeof import("./operations-fs.mjs").validateTaskFrontmatter>} task
 */
export function canAutoRunTask(task) {
  if (task.status !== "pending" && task.status !== "approved") return false;
  if (task.status === "approved") return true;
  if (task.needs_decision) return false;
  const cmds = task.suggested_commands ?? [];
  if (!cmds.length) return false;
  return cmds.every(
    (c) =>
      (/\bquery\b/.test(c) && !/\b(deploy|teardown|prune)\b/.test(c)) ||
      (/unifi-network\s+maintain/.test(c) && /--block\b/.test(c) && !/\b--prune\b/.test(c)),
  );
}

/**
 * @param {string} privateRoot
 */
export function dispatcherStatePath(privateRoot) {
  return join(privateRoot, "operations", ".dispatcher-state.json");
}

/**
 * @param {string} privateRoot
 * @returns {Record<string, unknown>}
 */
export function loadDispatcherState(privateRoot) {
  const path = dispatcherStatePath(privateRoot);
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

/**
 * @param {string} privateRoot
 * @param {Record<string, unknown>} state
 */
export function saveDispatcherState(privateRoot, state) {
  mkdirSync(join(privateRoot, "operations"), { recursive: true });
  writeFileSync(dispatcherStatePath(privateRoot), `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

/**
 * @param {string} dir
 * @param {RegExp} [nameRe]
 */
export function newestMtimeMs(dir, nameRe) {
  if (!existsSync(dir)) return 0;
  let newest = 0;
  for (const name of readdirSync(dir)) {
    if (nameRe && !nameRe.test(name)) continue;
    try {
      const st = statSync(join(dir, name));
      if (st.isFile() && st.mtimeMs > newest) newest = st.mtimeMs;
    } catch {
      /* skip */
    }
  }
  return newest;
}

/**
 * @typedef {{ id: string, prompt: string, local?: boolean, peer_url?: string }} DispatcherWorkItem
 * @typedef {{
 *   role: string,
 *   invoked_llm: boolean,
 *   work: DispatcherWorkItem[],
 *   report_path?: string,
 *   discord_notified?: string[],
 *   idle_reason?: string,
 * }} DispatcherResult
 */

/** @type {Record<string, number>} */
const PEER_PORTS = {
  "hdc-manager": 9200,
  "hdc-monitor": 9201,
  "hdc-sre-ops": 9202,
  "hdc-sre": 9202,
  "hdc-security-expert": 9203,
  "hdc-security-architect": 9204,
  "hdc-network-architect": 9205,
  "hdc-research": 9206,
  "hdc-engineer": 9207,
  "hdc-sre-engineer": 9208,
};

/**
 * Compose service hostname = role id (e.g. hdc-sre-ops).
 * @param {string} peerRole
 * @param {NodeJS.ProcessEnv} [env]
 */
export function peerA2aBaseUrl(peerRole, env = process.env) {
  const normalized =
    peerRole === "hdc-sre" ? "hdc-sre-ops" : peerRole;
  const override = env[`HDC_AGENT_PEER_URL_${normalized.replace(/-/g, "_").toUpperCase()}`];
  if (override?.trim()) return override.trim().replace(/\/$/, "");
  const port = PEER_PORTS[normalized] ?? PEER_PORTS[peerRole];
  if (!port) return null;
  const host = String(env.HDC_AGENT_PEER_HOST ?? normalized).trim() || normalized;
  return `http://${host}:${port}`;
}

/**
 * @param {string} hdcRoot
 * @param {string} privateRoot
 */
function loadMailboxConfig(hdcRoot, privateRoot) {
  const metaPath = join(
    String(process.env.HDC_AGENTS_META_ROOT || "/opt/hdc-agents-meta").trim() ||
      "/opt/hdc-agents-meta",
    "mailbox.json",
  );
  if (existsSync(metaPath)) {
    try {
      return JSON.parse(readFileSync(metaPath, "utf8"));
    } catch {
      /* fall through */
    }
  }
  for (const p of [
    join(privateRoot, "clumps", "services", "hdc-agents", "config.json"),
    join(hdcRoot, "clumps", "services", "hdc-agents", "config.json"),
  ]) {
    if (!existsSync(p)) continue;
    try {
      const raw = JSON.parse(readFileSync(p, "utf8"));
      const agents = raw?.defaults?.hdc_agents ?? raw?.hdc_agents;
      if (agents?.mailbox && typeof agents.mailbox === "object") return agents.mailbox;
    } catch {
      /* next */
    }
  }
  return { enabled: true };
}

/**
 * Scripted triage / work detection. Returns work items for the LLM harness;
 * empty `work` means idle (no model call).
 *
 * @param {object} opts
 * @param {string} opts.role
 * @param {string} opts.hdcRoot
 * @param {string} opts.privateRoot
 * @param {(line: string) => void} [opts.log]
 * @param {number} [opts.nowMs]
 */
export async function runDispatcher(opts) {
  const log = opts.log ?? ((line) => process.stderr.write(`${line}\n`));
  const nowMs = opts.nowMs ?? Date.now();
  const privateRoot = opts.privateRoot?.trim() || "";
  if (!privateRoot) {
    return {
      role: opts.role,
      invoked_llm: false,
      work: [],
      idle_reason: "HDC_PRIVATE_ROOT unset",
    };
  }

  switch (opts.role) {
    case "hdc-manager":
      return dispatchManager({ ...opts, privateRoot, nowMs, log });
    case "hdc-monitor":
      return dispatchProbeThenLlm({
        ...opts,
        privateRoot,
        nowMs,
        log,
        stateKey: "monitor_probe_hash",
        probes: [
          ["run", "service", "uptime-kuma", "query", "--", "--live"],
          ["run", "infrastructure", "proxmox", "query"],
        ],
        llmPrompt:
          "Scheduled monitor sweep. Probe hashes changed (or first run). Analyze health, " +
          "write operations/reports/monitor-*.md, enqueue hdc-sre-ops tasks for actionable issues.",
      });
    case "hdc-security-expert":
      return dispatchProbeThenLlm({
        ...opts,
        privateRoot,
        nowMs,
        log,
        stateKey: "security_probe_hash",
        probes: [
          ["run", "service", "wazuh", "query", "--", "--live"],
          ["run", "service", "crowdsec", "query", "--", "--live"],
          ["run", "service", "nginx-waf", "query"],
        ],
        llmPrompt:
          "Scheduled security sweep. Probe hashes changed (or first run). Analyze alerts, " +
          "write operations/reports/security-*.md; bounded response only; escalate novel threats.",
      });
    case "hdc-research":
      return dispatchResearch({ ...opts, privateRoot, nowMs, log });
    default:
      return {
        role: opts.role,
        invoked_llm: false,
        work: [],
        idle_reason: "no idle schedule for this role (A2A on-demand only)",
      };
  }
}

/**
 * @param {object} opts
 * @param {string} opts.hdcRoot
 * @param {string} opts.privateRoot
 * @param {number} opts.nowMs
 * @param {(line: string) => void} opts.log
 */
async function dispatchManager(opts) {
  try {
    await processManagerMailbox({
      hdcRoot: opts.hdcRoot,
      privateRoot: opts.privateRoot,
      mailboxConfig: loadMailboxConfig(opts.hdcRoot, opts.privateRoot),
      log: opts.log,
    });
  } catch (e) {
    opts.log(`[dispatcher] mailbox poll failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  const tasks = listTasks(opts.privateRoot, { includeDone: true });
  const reportPath = writeTaskReport(opts.privateRoot, tasks, {
    source: "hdc-agent-server-dispatcher",
  });

  const state = loadDispatcherState(opts.privateRoot);
  /** @type {string[]} */
  const notified = Array.isArray(state.discord_notified_ids)
    ? /** @type {string[]} */ (state.discord_notified_ids)
    : [];
  const notifiedSet = new Set(notified);
  /** @type {string[]} */
  const newlyNotified = [];

  for (const t of tasks) {
    if (!t.needs_decision || t.status === "done") continue;
    if (notifiedSet.has(t.id)) continue;
    const msg = `Task ${t.id}: ${t.title}. Needs operator decision.`;
    const r = notifyDiscordDecision(
      opts.hdcRoot,
      opts.privateRoot,
      "HDC decision needed",
      msg,
      t.id,
    );
    if (r.ok) {
      newlyNotified.push(t.id);
      notifiedSet.add(t.id);
      opts.log(`[dispatcher] discord notified for ${t.id}`);
    } else {
      opts.log(`[dispatcher] discord notify failed for ${t.id}: ${r.error || r.stderr || r.status}`);
    }
  }

  /** @type {DispatcherWorkItem[]} */
  const work = [];

  const reportsDir = join(opts.privateRoot, "operations", "reports");
  const newestReport = newestMtimeMs(reportsDir, /^(?!manager-triage-).+\.md$/i);
  const lastReport = Number(state.manager_last_report_mtime ?? 0);
  const agentsReports = join(opts.hdcRoot, "clumps", "services", "hdc-agents", "reports");
  const privateAgentsReports = join(opts.privateRoot, "clumps", "services", "hdc-agents", "reports");
  const newestFailureSignal = Math.max(
    newestMtimeMs(agentsReports),
    newestMtimeMs(privateAgentsReports),
    newestMtimeMs(join(opts.privateRoot, "apps", "hdc-cli", "reports"), /daily-maintain/),
    newestMtimeMs(join(opts.hdcRoot, "apps", "hdc-cli", "reports"), /daily-maintain/),
  );
  const lastFailure = Number(state.manager_last_failure_mtime ?? 0);
  const seeded = state.manager_watermarks_seeded === true;
  const needsTriageLlm =
    seeded && (newestReport > lastReport || newestFailureSignal > lastFailure);

  if (needsTriageLlm) {
    work.push({
      id: `manager-triage-${opts.nowMs}`,
      local: true,
      prompt:
        "Scripted dispatcher found new digests or failure reports. Triage: update tasks, " +
        "prioritize, regenerate task-report.md, escalate needs_decision via Discord if still needed. " +
        "Do not run deploy/prune without approved tasks.",
    });
  }

  const runnable = tasks.filter(
    (t) =>
      canAutoRunTask(t) &&
      t.status !== "done" &&
      t.status !== "in_progress" &&
      t.status !== "blocked",
  );
  for (const t of runnable) {
    const prompt =
      `Execute task ${t.id}. Read operations/tasks/${t.id}.md. ` +
      `Set in_progress then done/blocked. Use hdc tools only. Suggested: ${(t.suggested_commands || []).join("; ") || "(see task body)"}.`;
    if (t.role === "hdc-manager") {
      work.push({ id: `task-${t.id}`, local: true, prompt });
      continue;
    }
    const peer = peerA2aBaseUrl(t.role);
    if (peer) {
      work.push({ id: `task-${t.id}`, peer_url: peer, prompt });
    } else {
      opts.log(`[dispatcher] no peer URL for role ${t.role}; skipping ${t.id}`);
    }
  }

  state.discord_notified_ids = [...notifiedSet];
  state.manager_last_report_mtime = Math.max(lastReport, newestReport);
  state.manager_last_failure_mtime = Math.max(lastFailure, newestFailureSignal);
  state.manager_last_run_ms = opts.nowMs;
  state.manager_watermarks_seeded = true;
  saveDispatcherState(opts.privateRoot, state);

  const date = new Date(opts.nowMs).toISOString().slice(0, 10);
  const digestPath = join(opts.privateRoot, "operations", "reports", `manager-triage-${date}.md`);
  const digest = [
    `# Manager triage ${date}`,
    "",
    `Source: hdc-agent-server-dispatcher`,
    `LLM work items: ${work.length}`,
    `Discord newly notified: ${newlyNotified.join(", ") || "(none)"}`,
    `Task report: ${reportPath}`,
    "",
    "## Open tasks",
    ...tasks
      .filter((t) => t.status !== "done")
      .map((t) => `- **${t.id}** (${t.priority}/${t.status}) — ${t.title}`),
    "",
  ].join("\n");
  writeFileSync(digestPath, digest, "utf8");

  if (work.length === 0) {
    opts.log(`[dispatcher] manager idle (report refreshed, no LLM)`);
    return {
      role: "hdc-manager",
      invoked_llm: false,
      work: [],
      report_path: reportPath,
      discord_notified: newlyNotified,
      idle_reason: "no new reports and no runnable tasks",
    };
  }

  return {
    role: "hdc-manager",
    invoked_llm: true,
    work,
    report_path: reportPath,
    discord_notified: newlyNotified,
  };
}

/**
 * @param {object} opts
 * @param {string} opts.role
 * @param {string} opts.hdcRoot
 * @param {string} opts.privateRoot
 * @param {number} opts.nowMs
 * @param {(line: string) => void} opts.log
 * @param {string} opts.stateKey
 * @param {string[][]} opts.probes
 * @param {string} opts.llmPrompt
 */
function dispatchProbeThenLlm(opts) {
  /** @type {string[]} */
  const chunks = [];
  for (const args of opts.probes) {
    const r = runHdcCliCapture(opts.hdcRoot, args);
    chunks.push(`# ${args.join(" ")}\nok=${r.ok}\n${r.stdout.slice(0, 8000)}`);
    if (!r.ok) {
      opts.log(`[dispatcher] probe failed (${args.join(" ")}): ${r.stderr || r.status}`);
    }
  }
  const hash = sha256Hex(chunks.join("\n---\n"));
  const state = loadDispatcherState(opts.privateRoot);
  const prev = String(state[opts.stateKey] ?? "");
  if (prev && prev === hash) {
    opts.log(`[dispatcher] ${opts.role} idle (probe hash unchanged)`);
    state[`${opts.stateKey}_checked_ms`] = opts.nowMs;
    saveDispatcherState(opts.privateRoot, state);
    return {
      role: opts.role,
      invoked_llm: false,
      work: [],
      idle_reason: "probe hash unchanged",
    };
  }

  state[opts.stateKey] = hash;
  state[`${opts.stateKey}_checked_ms`] = opts.nowMs;
  saveDispatcherState(opts.privateRoot, state);

  return {
    role: opts.role,
    invoked_llm: true,
    work: [
      {
        id: `${opts.role}-sweep-${opts.nowMs}`,
        local: true,
        prompt: `${opts.llmPrompt}\n\nProbe snapshot (truncated):\n${chunks.join("\n---\n").slice(0, 12000)}`,
      },
    ],
  };
}

/**
 * @param {object} opts
 */
function dispatchResearch(opts) {
  const date = new Date(opts.nowMs).toISOString().slice(0, 10);
  const queued = listQueuedTopics(opts.privateRoot);

  if (queued.length > 0) {
    const topicList = queued
      .map((t) => `- ${t.id}: ${t.title}${t.url ? ` (${t.url})` : ""}`)
      .join("\n");
    return {
      role: "hdc-research",
      invoked_llm: true,
      work: [
        {
          id: `research-topics-${date}`,
          local: true,
          prompt:
            `Process queued research topics (priority over weekly brief).\n\n` +
            `Queued topics:\n${topicList}\n\n` +
            `For each topic: set status in_progress, write operations/reports/research-topic-<id>-${date}.md, ` +
            `set status done with outcome and report path, regenerate operations/research/index.md. ` +
            `Create low-priority manager tasks for adopt or manual-only outcomes.`,
        },
      ],
    };
  }

  const path = join(opts.privateRoot, "operations", "reports", `research-${date}.md`);
  if (existsSync(path)) {
    return {
      role: "hdc-research",
      invoked_llm: false,
      work: [],
      idle_reason: `research brief already exists for ${date}`,
    };
  }
  return {
    role: "hdc-research",
    invoked_llm: true,
    work: [
      {
        id: `research-${date}`,
        local: true,
        prompt: `Weekly research brief for ${date}. Write operations/reports/research-${date}.md and enqueue low-priority manager tasks for worth-adopting tools.`,
      },
    ],
  };
}
