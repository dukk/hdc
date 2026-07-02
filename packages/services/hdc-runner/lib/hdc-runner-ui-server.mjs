#!/usr/bin/env node
/**
 * hdc-runner Web UI HTTP server (guest).
 *
 * Started by systemd as user hdc; reads /opt/hdc-runner/web-config.json + .env secrets.
 */
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { URL } from "node:url";

import {
  SESSION_COOKIE,
  createSessionToken,
  verifySessionToken,
  parseCookies,
  sessionSetCookieHeader,
  sessionClearCookieHeader,
  validateLogin,
  resolveAuthUser,
  isLoginRateLimited,
  recordLoginFailure,
} from "./hdc-runner-ui-auth.mjs";
import {
  listSchedulesWithStatus,
  readScheduleLog,
  loadSchedulesFile,
  scheduleExists,
} from "./hdc-runner-ui-schedules.mjs";
import {
  canStartJob,
  spawnJob,
  spawnAgentTaskJob,
  listJobs,
  readJobMeta,
  readJobLog,
  writeJobMeta,
  ensureJobsDir,
} from "./hdc-runner-ui-jobs.mjs";
import { listInventoryCategory, getInventoryRecord } from "./hdc-runner-ui-inventory.mjs";
import {
  listPackageCatalog,
  validatePackageRun,
  normalizeCliArgs,
  parseArgsString,
} from "./hdc-runner-ui-packages.mjs";
import { validatePackagePolicy, validateSchedulePolicy } from "./hdc-runner-ui-policy.mjs";
import { handleA2aRequest } from "./hdc-runner-a2a.mjs";
import {
  getTaskApiPayload,
  getTasksApiPayload,
  listAgentRoster,
  patchTaskApi,
  readTaskReport,
} from "./hdc-runner-ui-tasks.mjs";
import { readTask } from "./hdc-runner-tasks.mjs";

const META_ROOT = process.env.HDC_RUNNER_META_ROOT || "/opt/hdc-runner";
const INSTALL_ROOT = process.env.HDC_RUNNER_INSTALL_ROOT || "/opt/hdc";
const PRIVATE_ROOT = process.env.HDC_RUNNER_PRIVATE_ROOT || "/opt/hdc-private";
const WEB_ROOT = join(META_ROOT, "web");

/** @type {Record<string, string>} */
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

/**
 * @param {string} path
 */
function loadDotEnv(path) {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) {
      try {
        val = JSON.parse(val);
      } catch {
        val = val.slice(1, -1);
      }
    } else if (val.startsWith("'") && val.endsWith("'")) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

function loadWebConfig() {
  const path = join(META_ROOT, "web-config.json");
  if (!existsSync(path)) {
    return {
      enabled: true,
      host: "0.0.0.0",
      port: 9120,
      username: "hdc",
      allowed_verbs: ["query", "maintain"],
      max_concurrent_jobs: 1,
    };
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * @param {import("node:http").ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 * @param {Record<string, string>} [headers]
 */
function jsonResponse(res, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(payload);
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
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {ReturnType<typeof loadWebConfig>} webConfig
 * @param {string} uiPassword
 * @param {string} sessionSecret
 * @param {string} [apiToken]
 */
async function handleRequest(req, res, webConfig, uiPassword, sessionSecret, apiToken) {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const path = url.pathname;

  if (path === "/api/health" && req.method === "GET") {
    return jsonResponse(res, 200, { ok: true });
  }

  if (
    (path === "/.well-known/agent.json" || path.startsWith("/a2a")) &&
    (await handleA2aRequest({
      req,
      res,
      url,
      privateRoot: PRIVATE_ROOT,
      installRoot: INSTALL_ROOT,
      user: resolveAuthUser(req, sessionSecret, apiToken),
      jsonResponse,
      readJsonBody,
    }))
  ) {
    return;
  }

  if (path === "/api/auth/login" && req.method === "POST") {
    if (isLoginRateLimited()) {
      return jsonResponse(res, 429, { error: "too many login attempts" });
    }
    try {
      const body = /** @type {{ username?: string; password?: string }} */ (await readJsonBody(req));
      const username = String(body.username ?? "").trim();
      const password = String(body.password ?? "");
      if (
        !validateLogin(username, password, webConfig.username ?? "hdc", uiPassword)
      ) {
        recordLoginFailure();
        return jsonResponse(res, 401, { error: "invalid credentials" });
      }
      const token = createSessionToken(username, sessionSecret);
      return jsonResponse(res, 200, { ok: true, user: username }, {
        "Set-Cookie": sessionSetCookieHeader(token),
      });
    } catch {
      return jsonResponse(res, 400, { error: "invalid request body" });
    }
  }

  const user = resolveAuthUser(req, sessionSecret, apiToken);
  const needsAuth = path.startsWith("/api/") && path !== "/api/health";
  if (needsAuth && !user) {
    return jsonResponse(res, 401, { error: "authentication required" });
  }

  if (path === "/api/auth/logout" && req.method === "POST") {
    return jsonResponse(res, 200, { ok: true }, { "Set-Cookie": sessionClearCookieHeader() });
  }

  if (path === "/api/auth/me" && req.method === "GET") {
    return jsonResponse(res, 200, {
      user,
      install_root: INSTALL_ROOT,
      private_root: PRIVATE_ROOT,
      meta_root: META_ROOT,
    });
  }

  if (path === "/api/schedules" && req.method === "GET") {
    return jsonResponse(res, 200, { schedules: listSchedulesWithStatus(META_ROOT) });
  }

  const scheduleLogMatch = path.match(/^\/api\/schedules\/([^/]+)\/log$/);
  if (scheduleLogMatch && req.method === "GET") {
    const scheduleId = decodeURIComponent(scheduleLogMatch[1]);
    const parsed = url.searchParams.get("parsed") === "1";
    const offset = Number(url.searchParams.get("offset") || 0);
    const limit = Number(url.searchParams.get("limit") || 0);
    return jsonResponse(
      res,
      200,
      readScheduleLog(scheduleId, { parsed, offset, limit: limit || undefined }),
    );
  }

  const scheduleRunMatch = path.match(/^\/api\/schedules\/([^/]+)\/run$/);
  if (scheduleRunMatch && req.method === "POST") {
    const scheduleId = decodeURIComponent(scheduleRunMatch[1]);
    const schedules = loadSchedulesFile(META_ROOT);
    if (!scheduleExists(scheduleId, schedules)) {
      return jsonResponse(res, 404, { error: "schedule not found" });
    }
    const schedulePolicy = validateSchedulePolicy(webConfig, scheduleId);
    if (!schedulePolicy.ok) {
      return jsonResponse(res, 403, { error: schedulePolicy.error });
    }
    if (!canStartJob(META_ROOT, webConfig.max_concurrent_jobs ?? 1)) {
      return jsonResponse(res, 409, { error: "another job is already running" });
    }
    const spawned = spawnJob({
      metaRoot: META_ROOT,
      installRoot: INSTALL_ROOT,
      type: "schedule",
      scheduleId,
    });
    return jsonResponse(res, 202, { ok: true, job_id: spawned.jobId, pid: spawned.pid });
  }

  if (path === "/api/jobs" && req.method === "GET") {
    return jsonResponse(res, 200, { jobs: listJobs(META_ROOT) });
  }

  if (path === "/api/jobs" && req.method === "POST") {
    try {
      const body = /** @type {{ tier?: string; package?: string; verb?: string; args?: unknown; args_string?: string }} */ (
        await readJsonBody(req)
      );
      const tier = String(body.tier ?? "").trim();
      const pkg = String(body.package ?? "").trim();
      const verb = String(body.verb ?? "").trim();
      let args = [];
      if (Array.isArray(body.args)) {
        args = normalizeCliArgs(body.args);
      } else if (body.args_string) {
        args = parseArgsString(body.args_string);
      }
      const validation = await validatePackageRun(
        INSTALL_ROOT,
        tier,
        pkg,
        verb,
        webConfig.allowed_verbs ?? ["query", "maintain"],
      );
      if (!validation.ok) {
        return jsonResponse(res, 400, { error: validation.error });
      }
      const packagePolicy = validatePackagePolicy(webConfig, tier, pkg);
      if (!packagePolicy.ok) {
        return jsonResponse(res, 403, { error: packagePolicy.error });
      }
      if (!canStartJob(META_ROOT, webConfig.max_concurrent_jobs ?? 1)) {
        return jsonResponse(res, 409, { error: "another job is already running" });
      }
      const spawned = spawnJob({
        metaRoot: META_ROOT,
        installRoot: INSTALL_ROOT,
        type: "adhoc",
        tier,
        package: pkg,
        verb,
        args,
      });
      return jsonResponse(res, 202, { ok: true, job_id: spawned.jobId, pid: spawned.pid });
    } catch (e) {
      return jsonResponse(res, 400, {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const jobMatch = path.match(/^\/api\/jobs\/([^/]+)$/);
  if (jobMatch && req.method === "GET") {
    const jobId = decodeURIComponent(jobMatch[1]);
    const meta = readJobMeta(META_ROOT, jobId);
    if (!meta) return jsonResponse(res, 404, { error: "job not found" });
    const log = readJobLog(META_ROOT, jobId);
    return jsonResponse(res, 200, { job: meta, log: log.text, log_bytes: log.bytes });
  }

  if (path === "/api/packages" && req.method === "GET") {
    const catalog = await listPackageCatalog(INSTALL_ROOT, webConfig.allowed_verbs ?? ["query", "maintain"]);
    return jsonResponse(res, 200, catalog);
  }

  const invListMatch = path.match(/^\/api\/inventory\/([^/]+)$/);
  if (invListMatch && req.method === "GET") {
    const category = decodeURIComponent(invListMatch[1]);
    return jsonResponse(res, 200, listInventoryCategory(INSTALL_ROOT, PRIVATE_ROOT, category));
  }

  const invGetMatch = path.match(/^\/api\/inventory\/([^/]+)\/([^/]+)$/);
  if (invGetMatch && req.method === "GET") {
    const category = decodeURIComponent(invGetMatch[1]);
    const id = decodeURIComponent(invGetMatch[2]);
    const result = getInventoryRecord(INSTALL_ROOT, PRIVATE_ROOT, category, id);
    if (result.error) return jsonResponse(res, 404, result);
    return jsonResponse(res, 200, result);
  }

  if (path === "/api/agents" && req.method === "GET") {
    return jsonResponse(res, 200, { agents: listAgentRoster(INSTALL_ROOT) });
  }

  if (path === "/api/tasks/report" && req.method === "GET") {
    const report = readTaskReport(PRIVATE_ROOT);
    return jsonResponse(res, 200, { markdown: report ?? "" });
  }

  if (path === "/api/tasks" && req.method === "GET") {
    return jsonResponse(res, 200, getTasksApiPayload(PRIVATE_ROOT));
  }

  const taskRunMatch = path.match(/^\/api\/tasks\/([^/]+)\/run$/);
  if (taskRunMatch && req.method === "POST") {
    const taskId = decodeURIComponent(taskRunMatch[1]);
    try {
      const task = readTask(PRIVATE_ROOT, taskId);
      if (task.status !== "approved" && task.status !== "pending") {
        return jsonResponse(res, 409, { error: `task status ${task.status} cannot be run` });
      }
      if (!canStartJob(META_ROOT, webConfig.max_concurrent_jobs ?? 1)) {
        return jsonResponse(res, 409, { error: "another job is already running" });
      }
      if (task.status === "pending") {
        patchTaskApi(PRIVATE_ROOT, taskId, { status: "approved" }, { user, sessionOnly: false });
      }
      const spawned = spawnAgentTaskJob({
        metaRoot: META_ROOT,
        installRoot: INSTALL_ROOT,
        taskId,
      });
      return jsonResponse(res, 202, { ok: true, job_id: spawned.jobId, pid: spawned.pid });
    } catch (e) {
      return jsonResponse(res, 404, { error: e instanceof Error ? e.message : String(e) });
    }
  }

  const taskMatch = path.match(/^\/api\/tasks\/([^/]+)$/);
  if (taskMatch && req.method === "GET") {
    try {
      const taskId = decodeURIComponent(taskMatch[1]);
      return jsonResponse(res, 200, getTaskApiPayload(PRIVATE_ROOT, taskId));
    } catch (e) {
      return jsonResponse(res, 404, { error: e instanceof Error ? e.message : String(e) });
    }
  }

  if (taskMatch && req.method === "PATCH") {
    if (user === "api-token") {
      return jsonResponse(res, 403, { error: "session authentication required for task approval" });
    }
    try {
      const taskId = decodeURIComponent(taskMatch[1]);
      const body = /** @type {Record<string, unknown>} */ (await readJsonBody(req));
      const result = patchTaskApi(PRIVATE_ROOT, taskId, body, { user, sessionOnly: true });
      if (!result.ok) {
        return jsonResponse(res, result.status ?? 400, { error: result.error });
      }
      return jsonResponse(res, 200, { task: result.task });
    } catch (e) {
      return jsonResponse(res, 400, { error: e instanceof Error ? e.message : String(e) });
    }
  }

  if (req.method === "GET" && !path.startsWith("/api/")) {
    const stat = serveStatic(path);
    if (stat) {
      res.writeHead(200, { "Content-Type": stat.contentType, "Cache-Control": "no-cache" });
      res.end(stat.body);
      return;
    }
  }

  jsonResponse(res, 404, { error: "not found" });
}

/**
 * @param {string} urlPath
 */
function serveStatic(urlPath) {
  let rel = urlPath === "/" ? "/index.html" : urlPath;
  if (rel.includes("..")) return null;
  const filePath = join(WEB_ROOT, rel);
  if (!existsSync(filePath)) return null;
  const ext = extname(filePath);
  return { body: readFileSync(filePath), contentType: MIME[ext] ?? "application/octet-stream" };
}

function main() {
  loadDotEnv(join(META_ROOT, ".env"));
  const webConfig = loadWebConfig();
  if (webConfig.enabled === false) {
    process.stderr.write("[hdc-runner-ui] web UI disabled in web-config.json\n");
    process.exit(0);
  }

  const uiPassword = process.env.HDC_HDC_RUNNER_UI_PASSWORD ?? "";
  const sessionSecret = process.env.HDC_HDC_RUNNER_UI_SESSION_SECRET ?? "";
  const apiToken = process.env.HDC_HDC_RUNNER_API_TOKEN ?? "";
  if (!uiPassword || !sessionSecret) {
    process.stderr.write("[hdc-runner-ui] missing HDC_HDC_RUNNER_UI_PASSWORD or session secret in .env\n");
    process.exit(1);
  }
  if (!apiToken) {
    process.stderr.write("[hdc-runner-ui] warning: HDC_HDC_RUNNER_API_TOKEN not set — Bearer auth disabled\n");
  }

  ensureJobsDir(META_ROOT);

  const host = webConfig.host ?? "0.0.0.0";
  const port = webConfig.port ?? 9120;

  const server = createServer((req, res) => {
    handleRequest(req, res, webConfig, uiPassword, sessionSecret, apiToken || undefined).catch((e) => {
      jsonResponse(res, 500, { error: e instanceof Error ? e.message : String(e) });
    });
  });

  server.listen(port, host, () => {
    process.stderr.write(`[hdc-runner-ui] listening on http://${host}:${port}\n`);
  });
}

main();
