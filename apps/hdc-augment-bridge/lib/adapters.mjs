import { spawn } from "node:child_process";

const CURSOR_API_BASE = "https://api.cursor.com";

/**
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {string} opts.prompt
 * @param {string} [opts.repositoryUrl]
 * @param {string} [opts.ref]
 * @param {typeof fetch} [opts.fetchImpl]
 */
export async function runCursorCloudAugment(opts) {
  const apiKey = String(opts.apiKey ?? "").trim();
  if (!apiKey) throw new Error("HDC_CURSOR_CLOUD_API_KEY (or CURSOR_API_KEY) is required for cursor-cloud runtime");
  const prompt = String(opts.prompt ?? "").trim();
  if (!prompt) throw new Error("prompt is required");

  const fetchImpl = opts.fetchImpl ?? fetch;
  /** @type {Record<string, unknown>} */
  const body = {
    prompt: { text: prompt },
  };
  const repoUrl = String(opts.repositoryUrl ?? "").trim();
  if (repoUrl) {
    body.source = {
      repository: repoUrl,
      ref: String(opts.ref ?? "main").trim() || "main",
    };
  }

  const res = await fetchImpl(`${CURSOR_API_BASE}/v1/agents`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`Cursor Cloud API ${res.status}: ${text.slice(0, 500)}`);
  }

  const agent = data?.agent && typeof data.agent === "object" ? data.agent : data;
  const run = data?.run && typeof data.run === "object" ? data.run : null;
  const agentId = agent?.id ?? data?.id;
  const runId = run?.id ?? data?.latestRunId ?? data?.run_id;

  return {
    summary: `Cursor Cloud agent created${agentId ? ` (agent ${agentId})` : ""}`,
    agent_id: agentId != null ? String(agentId) : undefined,
    run_id: runId != null ? String(runId) : undefined,
    task_id: runId != null ? String(runId) : agentId != null ? String(agentId) : undefined,
    raw: data,
  };
}

/**
 * @param {object} opts
 * @param {string} opts.command
 * @param {string} opts.prompt
 * @param {string} [opts.workspace]
 * @param {number} [opts.timeoutMs]
 */
export function runCliAugment(opts) {
  const commandLine = String(opts.command ?? "").trim();
  if (!commandLine) throw new Error("HDC_AUGMENT_CLI_COMMAND is required for CLI runtimes");
  const prompt = String(opts.prompt ?? "").trim();
  if (!prompt) throw new Error("prompt is required");

  return new Promise((resolve, reject) => {
    const child = spawn(commandLine, [prompt], {
      cwd: opts.workspace || undefined,
      shell: true,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    /** @type {string[]} */
    const stdout = [];
    /** @type {string[]} */
    const stderr = [];
    child.stdout?.on("data", (c) => stdout.push(String(c)));
    child.stderr?.on("data", (c) => stderr.push(String(c)));
    const timeoutMs = Number(opts.timeoutMs ?? 600_000);
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`CLI augment timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const out = stdout.join("").trim();
      const err = stderr.join("").trim();
      if (code !== 0) {
        reject(new Error(`CLI augment exit ${code}: ${err || out || "unknown error"}`));
        return;
      }
      resolve({
        summary: out.slice(0, 4000) || "CLI augment completed",
        task_id: `cli-${Date.now()}`,
        stdout: out,
        stderr: err,
      });
    });
  });
}

/**
 * @param {object} config
 * @param {string} prompt
 * @param {{ fetchImpl?: typeof fetch }} [opts]
 */
export async function runAugmentAdapter(config, prompt, opts = {}) {
  const runtime = String(config.runtime ?? "").trim();
  switch (runtime) {
    case "cursor-cloud":
      return runCursorCloudAugment({
        apiKey: config.cursorApiKey,
        prompt,
        repositoryUrl: config.cursorRepositoryUrl,
        ref: config.cursorRef,
        fetchImpl: opts.fetchImpl,
      });
    case "cursor-cli":
      return runCliAugment({
        command: config.cliCommand || "cursor agent",
        prompt,
        workspace: config.workspace,
      });
    case "claude-code":
      return runCliAugment({
        command: config.cliCommand || "claude -p",
        prompt,
        workspace: config.workspace,
      });
    default:
      throw new Error(`unsupported augment runtime ${JSON.stringify(runtime)}`);
  }
}
