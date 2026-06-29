#!/usr/bin/env node
/**
 * Paperclip HTTP adapter bridge — runs on hdc-runner guest (default :9121).
 * Maps heartbeat task titles to hdc-runner API schedule/job calls.
 *
 * Env: HDC_PAPERCLIP_BRIDGE_SECRET, HDC_HDC_RUNNER_API_TOKEN, HDC_RUNNER_BRIDGE_URL
 */
import { createServer } from "node:http";

const BRIDGE_SECRET = process.env.HDC_PAPERCLIP_BRIDGE_SECRET ?? "";
const RUNNER_URL = (process.env.HDC_RUNNER_BRIDGE_URL ?? "http://127.0.0.1:9120").replace(/\/$/, "");
const RUNNER_TOKEN = process.env.HDC_HDC_RUNNER_API_TOKEN ?? "";
const HOST = process.env.HDC_RUNNER_BRIDGE_HOST ?? "0.0.0.0";
const PORT = Number(process.env.HDC_RUNNER_BRIDGE_PORT ?? 9121);

/** @type {{ pattern: RegExp; scheduleId: string }[]} */
const TITLE_ROUTES = [
  { pattern: /uptime[- ]?kuma|monitor.*uptime/i, scheduleId: "monitor-uptime-kuma" },
  { pattern: /proxmox|cluster.*snapshot|monitor.*cluster/i, scheduleId: "monitor-cluster" },
  { pattern: /crowdsec|security.*crowd/i, scheduleId: "security-crowdsec" },
  { pattern: /wazuh|security.*wazuh/i, scheduleId: "security-wazuh" },
  { pattern: /waf|nginx[- ]?waf|security.*waf/i, scheduleId: "security-waf" },
  { pattern: /daily.*maintain|daily.*digest/i, scheduleId: "daily-digest" },
];

/**
 * @param {string} title
 * @param {string} [description]
 */
function resolveScheduleId(title, description) {
  const text = `${title}\n${description ?? ""}`;
  for (const route of TITLE_ROUTES) {
    if (route.pattern.test(text)) return route.scheduleId;
  }
  return null;
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @returns {Promise<unknown>}
 */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve(text ? JSON.parse(text) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

/**
 * @param {string} path
 * @param {string} [method]
 * @param {unknown} [body]
 */
async function runnerFetch(path, method = "GET", body) {
  const headers = {
    Authorization: `Bearer ${RUNNER_TOKEN}`,
    Accept: "application/json",
  };
  /** @type {RequestInit} */
  const init = { method, headers };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`${RUNNER_URL}${path}`, init);
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { status: res.status, data };
}

/**
 * @param {string} jobId
 * @param {number} maxWaitMs
 */
async function waitForJob(jobId, maxWaitMs = 300_000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const { status, data } = await runnerFetch(`/api/jobs/${encodeURIComponent(jobId)}`);
    if (status === 404) return { ok: false, error: "job not found", data };
    const job = /** @type {{ status?: string; exit_code?: number }} */ (data.job ?? data);
    if (job.status && job.status !== "running") {
      return { ok: job.status === "completed", job, log: data.log };
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return { ok: false, error: "timeout waiting for job" };
}

/**
 * @param {import("node:http").ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 */
function jsonResponse(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

/**
 * @param {import("node:http").IncomingMessage} req
 */
function verifyBridgeSecret(req) {
  if (!BRIDGE_SECRET) return false;
  const header =
    req.headers["x-hdc-bridge-secret"] ??
    req.headers["x-hdc-bridge-secret".toLowerCase()];
  const val = Array.isArray(header) ? header[0] : header;
  if (!val || typeof val !== "string") return false;
  if (val.length !== BRIDGE_SECRET.length) return false;
  let mismatch = 0;
  for (let i = 0; i < val.length; i++) {
    mismatch |= val.charCodeAt(i) ^ BRIDGE_SECRET.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 */
async function handleRequest(req, res) {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (url.pathname === "/api/health" && req.method === "GET") {
    return jsonResponse(res, 200, { ok: true, service: "paperclip-agent-bridge" });
  }

  if (url.pathname !== "/paperclip/heartbeat" || req.method !== "POST") {
    return jsonResponse(res, 404, { error: "not found" });
  }

  if (!verifyBridgeSecret(req)) {
    return jsonResponse(res, 401, { error: "invalid bridge secret" });
  }

  if (!RUNNER_TOKEN) {
    return jsonResponse(res, 503, { error: "HDC_HDC_RUNNER_API_TOKEN not configured" });
  }

  try {
    const body = /** @type {Record<string, unknown>} */ (await readJsonBody(req));
    const issue = isObject(body.issue) ? body.issue : body;
    const title = String(issue.title ?? body.title ?? "").trim();
    const description = String(issue.description ?? body.description ?? "").trim();
    const scheduleId = resolveScheduleId(title, description);

    if (!scheduleId) {
      return jsonResponse(res, 422, {
        ok: false,
        error: "no matching hdc-runner schedule for task title",
        title,
      });
    }

    const started = await runnerFetch(`/api/schedules/${encodeURIComponent(scheduleId)}/run`, "POST");
    if (started.status !== 202) {
      return jsonResponse(res, started.status, {
        ok: false,
        error: "failed to start schedule",
        schedule_id: scheduleId,
        runner: started.data,
      });
    }

    const jobId = String(started.data.job_id ?? "");
    if (!jobId) {
      return jsonResponse(res, 502, { ok: false, error: "runner returned no job_id" });
    }

    const result = await waitForJob(jobId);
    return jsonResponse(res, result.ok ? 200 : 500, {
      ok: result.ok,
      schedule_id: scheduleId,
      job_id: jobId,
      job: result.job,
      log_excerpt: typeof result.log === "string" ? result.log.slice(-4000) : undefined,
      error: result.error,
    });
  } catch (e) {
    return jsonResponse(res, 500, {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/** @param {unknown} v */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function main() {
  if (!BRIDGE_SECRET) {
    process.stderr.write("[paperclip-bridge] missing HDC_PAPERCLIP_BRIDGE_SECRET\n");
    process.exit(1);
  }
  createServer((req, res) => {
    handleRequest(req, res).catch((e) => {
      jsonResponse(res, 500, { error: e instanceof Error ? e.message : String(e) });
    });
  }).listen(PORT, HOST, () => {
    process.stderr.write(`[paperclip-bridge] listening on http://${HOST}:${PORT}\n`);
  });
}

main();
