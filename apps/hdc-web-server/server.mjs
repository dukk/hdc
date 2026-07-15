#!/usr/bin/env node
/**
 * hdc-web-server — LAN web UI + JSON API (ported from hdc-runner web UI).
 *
 * Port: HDC_WEB_PORT (default 9120)
 * Auth: encrypted htpasswd (default) or Keycloak OIDC (optional) → hdc_web_session cookie;
 *       HDC_WEB_API_TOKEN Bearer for agents
 */
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { URL } from "node:url";

import {
  createSessionToken,
  sessionSetCookieHeader,
  sessionClearCookieHeader,
  resolveAuthUser,
  parseCookies,
  isLoginRateLimited,
  recordLoginFailure,
} from "./lib/auth.mjs";
import {
  listSchedulesWithStatus,
  readScheduleLog,
  loadSchedulesFile,
  scheduleExists,
  ensureLogDir,
} from "./lib/schedules.mjs";
import {
  canStartJob,
  spawnJob,
  spawnAgentTaskJob,
  listJobs,
  readJobMeta,
  readJobLog,
  ensureJobsDir,
} from "./lib/jobs.mjs";
import { listInventoryCategory, getInventoryRecord } from "./lib/inventory.mjs";
import {
  listClumpCatalog,
  validatePackageRun,
  normalizeCliArgs,
  parseArgsString,
} from "./lib/clumps.mjs";
import { validatePackagePolicy, validateSchedulePolicy } from "./lib/policy.mjs";
import {
  getTaskApiPayload,
  getTasksApiPayload,
  listAgentRoster,
  patchTaskApi,
  readTask,
  readTaskReport,
} from "./lib/tasks.mjs";
import { getResearchPayload, postResearchSuggestion } from "./lib/research.mjs";
import {
  handleDiscordInteractionPayload,
  readRawBody,
  resolveOpsDiscordPublicKey,
  verifyDiscordInteractionSignature,
} from "./lib/discord-interactions.mjs";
import {
  resolveRoots,
  resolveSessionSecret,
  resolveApiToken,
  resolvePort,
  resolveAdminPassword,
} from "./lib/env.mjs";
import { ensureHtpasswdStore, verifyUser } from "./lib/htpasswd.mjs";
import {
  resolveOidcConfig,
  fetchOidcDiscovery,
  createOidcLoginState,
  encodeOidcStateCookie,
  decodeOidcStateCookie,
  oidcStateSetCookieHeader,
  oidcStateClearCookieHeader,
  buildAuthorizeUrl,
  exchangeAuthorizationCode,
  fetchOidcUserinfo,
  usernameFromUserinfo,
  buildEndSessionUrl,
  oidcStatesMatch,
  OIDC_STATE_COOKIE,
} from "./lib/oidc.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const DIST_ROOT = join(here, "dist");

/** @type {Record<string, string>} */
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".woff2": "font/woff2",
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
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

/**
 * @param {string} metaRoot
 */
function loadWebConfig(metaRoot) {
  const path = join(metaRoot, "web-config.json");
  if (!existsSync(path)) {
    return {
      enabled: true,
      host: "0.0.0.0",
      port: 9120,
      auth: {
        mode: "htpasswd",
        htpasswd_file: ".htpasswd.enc",
        admin_username: "admin",
      },
      allowed_verbs: ["query", "maintain"],
      max_concurrent_jobs: 1,
    };
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * @param {ReturnType<typeof loadWebConfig>} webConfig
 */
function resolveAuthConfig(webConfig) {
  const auth =
    webConfig.auth && typeof webConfig.auth === "object"
      ? /** @type {Record<string, unknown>} */ (webConfig.auth)
      : {};
  const mode = typeof auth.mode === "string" && auth.mode.trim() ? auth.mode.trim() : "htpasswd";
  const htpasswdFile =
    typeof auth.htpasswd_file === "string" && auth.htpasswd_file.trim()
      ? auth.htpasswd_file.trim()
      : ".htpasswd.enc";
  const adminUsername =
    typeof auth.admin_username === "string" && auth.admin_username.trim()
      ? auth.admin_username.trim()
      : "admin";
  return { mode, htpasswdFile, adminUsername };
}

/**
 * @param {ReturnType<typeof loadWebConfig>} webConfig
 * @param {string} metaRoot
 * @param {string} sessionSecret
 * @returns {{ passwordLoginEnabled: boolean; htpasswdStore: Map<string, string> | null }}
 */
function bootstrapHtpasswdAuth(webConfig, metaRoot, sessionSecret) {
  const { mode, htpasswdFile, adminUsername } = resolveAuthConfig(webConfig);
  if (mode === "oidc") {
    return { passwordLoginEnabled: false, htpasswdStore: null };
  }
  if (!sessionSecret) {
    process.stderr.write(
      "[hdc-web-server] warning: HDC_WEB_UI_SESSION_SECRET not set — password login disabled\n",
    );
    return { passwordLoginEnabled: false, htpasswdStore: null };
  }

  const filePath = join(metaRoot, htpasswdFile);
  const result = ensureHtpasswdStore({
    filePath,
    encryptKey: sessionSecret,
    adminUsername,
    adminPassword: resolveAdminPassword(),
  });

  if (result.createdAdmin) {
    if (result.generatedPassword) {
      process.stderr.write(
        `[hdc-web-server] created admin user '${adminUsername}' with generated password: ${result.generatedPassword} (save it now; not shown again)\n`,
      );
    } else {
      process.stderr.write(
        `[hdc-web-server] created admin user '${adminUsername}' from HDC_WEB_ADMIN_PASSWORD\n`,
      );
    }
  }

  return { passwordLoginEnabled: true, htpasswdStore: result.store };
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
 * @param {string} urlPath
 */
function serveStatic(urlPath) {
  if (!existsSync(DIST_ROOT)) return null;
  let rel = urlPath === "/" ? "/index.html" : urlPath;
  if (rel.includes("..")) return null;
  const parts = rel.replace(/^\//, "").split("/").filter(Boolean);
  const filePath = join(DIST_ROOT, ...parts);
  if (!existsSync(filePath)) {
    const indexPath = join(DIST_ROOT, "index.html");
    if (!existsSync(indexPath)) return null;
    return { body: readFileSync(indexPath), contentType: MIME[".html"] };
  }
  const ext = extname(filePath);
  return { body: readFileSync(filePath), contentType: MIME[ext] ?? "application/octet-stream" };
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {ReturnType<typeof loadWebConfig>} webConfig
 * @param {{ hdcRoot: string; privateRoot: string; metaRoot: string; logDir: string }} roots
 * @param {string} sessionSecret
 * @param {string} [apiToken]
 * @param {ReturnType<typeof resolveOidcConfig>} oidc
 * @param {{ passwordLoginEnabled: boolean; htpasswdStore: Map<string, string> | null }} htpasswdAuth
 */
async function handleRequest(
  req,
  res,
  webConfig,
  roots,
  sessionSecret,
  apiToken,
  oidc,
  htpasswdAuth,
) {
  const { hdcRoot: INSTALL_ROOT, privateRoot: PRIVATE_ROOT, metaRoot: META_ROOT, logDir } = roots;
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const path = url.pathname;

  if (path === "/api/health" && req.method === "GET") {
    return jsonResponse(res, 200, { ok: true });
  }

  // Discord Interactions (public; authenticated via Ed25519 signature)
  if (path === "/api/discord/interactions" && req.method === "POST") {
    const publicKey = resolveOpsDiscordPublicKey();
    if (!publicKey) {
      return jsonResponse(res, 503, { error: "Discord interactions not configured" });
    }
    let raw;
    try {
      raw = await readRawBody(req);
    } catch {
      return jsonResponse(res, 400, { error: "invalid request body" });
    }
    const signature = String(req.headers["x-signature-ed25519"] ?? "");
    const timestamp = String(req.headers["x-signature-timestamp"] ?? "");
    if (
      !verifyDiscordInteractionSignature({
        publicKeyHex: publicKey,
        signatureHex: signature,
        timestamp,
        rawBody: raw,
      })
    ) {
      return jsonResponse(res, 401, { error: "invalid request signature" });
    }
    let body;
    try {
      body = raw.length ? JSON.parse(raw.toString("utf8")) : {};
    } catch {
      return jsonResponse(res, 400, { error: "invalid JSON body" });
    }
    const result = handleDiscordInteractionPayload({
      body,
      privateRoot: PRIVATE_ROOT,
    });
    return jsonResponse(res, result.status, result.body);
  }

  if (path === "/api/auth/login" && req.method === "POST") {
    if (!htpasswdAuth.passwordLoginEnabled || !htpasswdAuth.htpasswdStore || !sessionSecret) {
      return jsonResponse(res, 503, { error: "password login not configured" });
    }
    if (isLoginRateLimited()) {
      return jsonResponse(res, 429, { error: "too many login attempts; try again later" });
    }
    try {
      const body = /** @type {{ username?: string; password?: string }} */ (await readJsonBody(req));
      const username = String(body.username ?? "").trim();
      const password = String(body.password ?? "");
      if (!verifyUser(htpasswdAuth.htpasswdStore, username, password)) {
        recordLoginFailure();
        return jsonResponse(res, 401, { error: "invalid username or password" });
      }
      const sessionToken = createSessionToken(username, sessionSecret);
      return jsonResponse(res, 200, { ok: true, user: username }, {
        "Set-Cookie": sessionSetCookieHeader(sessionToken),
      });
    } catch (e) {
      return jsonResponse(res, 400, {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  if (path === "/api/auth/oidc/login" && req.method === "GET") {
    if (!oidc.configured || !sessionSecret) {
      return jsonResponse(res, 503, { error: "OIDC not configured" });
    }
    try {
      const discovery = await fetchOidcDiscovery(oidc.issuer);
      const loginState = createOidcLoginState();
      const stateCookie = encodeOidcStateCookie(
        { state: loginState.state, codeVerifier: loginState.codeVerifier },
        sessionSecret,
      );
      const authorizeUrl = buildAuthorizeUrl({
        authorizationEndpoint: discovery.authorization_endpoint,
        clientId: oidc.clientId,
        redirectUri: oidc.redirectUri,
        state: loginState.state,
        codeChallenge: loginState.codeChallenge,
      });
      res.writeHead(302, {
        Location: authorizeUrl,
        "Cache-Control": "no-store",
        "Set-Cookie": oidcStateSetCookieHeader(stateCookie),
      });
      res.end();
      return;
    } catch (e) {
      return jsonResponse(res, 502, {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  if (path === "/api/auth/oidc/callback" && req.method === "GET") {
    if (!oidc.configured || !sessionSecret) {
      return jsonResponse(res, 503, { error: "OIDC not configured" });
    }
    const err = url.searchParams.get("error");
    if (err) {
      const desc = url.searchParams.get("error_description") || err;
      return jsonResponse(res, 401, { error: `OIDC error: ${desc}` }, {
        "Set-Cookie": oidcStateClearCookieHeader(),
      });
    }
    const code = url.searchParams.get("code") ?? "";
    const returnedState = url.searchParams.get("state") ?? "";
    const cookies = parseCookies(req);
    const stored = decodeOidcStateCookie(cookies[OIDC_STATE_COOKIE], sessionSecret);
    if (!code || !stored || !oidcStatesMatch(returnedState, stored.state)) {
      return jsonResponse(res, 401, { error: "invalid OIDC state or missing code" }, {
        "Set-Cookie": oidcStateClearCookieHeader(),
      });
    }
    try {
      const discovery = await fetchOidcDiscovery(oidc.issuer);
      const tokens = await exchangeAuthorizationCode({
        tokenEndpoint: discovery.token_endpoint,
        code,
        redirectUri: oidc.redirectUri,
        clientId: oidc.clientId,
        clientSecret: oidc.clientSecret,
        codeVerifier: stored.codeVerifier,
      });
      const userinfo = await fetchOidcUserinfo({
        userinfoEndpoint: discovery.userinfo_endpoint,
        accessToken: tokens.access_token,
      });
      const username = usernameFromUserinfo(userinfo);
      if (!username) {
        return jsonResponse(res, 401, { error: "OIDC userinfo missing username" }, {
          "Set-Cookie": oidcStateClearCookieHeader(),
        });
      }
      const sessionToken = createSessionToken(username, sessionSecret);
      const dest = oidc.publicUrl ? `${oidc.publicUrl}/` : "/";
      res.writeHead(302, {
        Location: dest,
        "Cache-Control": "no-store",
        "Set-Cookie": [sessionSetCookieHeader(sessionToken), oidcStateClearCookieHeader()],
      });
      res.end();
      return;
    } catch (e) {
      return jsonResponse(
        res,
        502,
        { error: e instanceof Error ? e.message : String(e) },
        { "Set-Cookie": oidcStateClearCookieHeader() },
      );
    }
  }

  const user = resolveAuthUser(req, sessionSecret, apiToken);

  if (path === "/api/auth/me" && req.method === "GET") {
    return jsonResponse(res, 200, {
      user,
      install_root: INSTALL_ROOT,
      private_root: PRIVATE_ROOT,
      meta_root: META_ROOT,
      oidc_configured: oidc.configured,
      password_login_enabled: htpasswdAuth.passwordLoginEnabled,
    });
  }

  const needsAuth =
    path.startsWith("/api/") &&
    path !== "/api/health" &&
    path !== "/api/discord/interactions" &&
    path !== "/api/auth/login" &&
    path !== "/api/auth/oidc/login" &&
    path !== "/api/auth/oidc/callback" &&
    path !== "/api/auth/me";
  if (needsAuth && !user) {
    return jsonResponse(res, 401, { error: "authentication required" });
  }

  if (path === "/api/auth/logout" && (req.method === "POST" || req.method === "GET")) {
    const clearSession = sessionClearCookieHeader();
    if (oidc.configured && oidc.publicUrl) {
      try {
        const discovery = await fetchOidcDiscovery(oidc.issuer);
        if (discovery.end_session_endpoint) {
          const endUrl = buildEndSessionUrl({
            endSessionEndpoint: discovery.end_session_endpoint,
            clientId: oidc.clientId,
            postLogoutRedirectUri: `${oidc.publicUrl}/`,
          });
          if (req.method === "GET") {
            res.writeHead(302, {
              Location: endUrl,
              "Cache-Control": "no-store",
              "Set-Cookie": clearSession,
            });
            res.end();
            return;
          }
          return jsonResponse(res, 200, { ok: true, logout_url: endUrl }, {
            "Set-Cookie": clearSession,
          });
        }
      } catch {
        /* fall through to local logout */
      }
    }
    return jsonResponse(res, 200, { ok: true }, { "Set-Cookie": clearSession });
  }

  if (path === "/api/schedules" && req.method === "GET") {
    return jsonResponse(res, 200, { schedules: listSchedulesWithStatus(META_ROOT, logDir) });
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
      readScheduleLog(logDir, scheduleId, { parsed, offset, limit: limit || undefined }),
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
      privateRoot: PRIVATE_ROOT,
      logDir,
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
      const body =
        /** @type {{ tier?: string; package?: string; verb?: string; args?: unknown; args_string?: string }} */ (
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
        privateRoot: PRIVATE_ROOT,
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
    const catalog = await listClumpCatalog(
      INSTALL_ROOT,
      webConfig.allowed_verbs ?? ["query", "maintain"],
    );
    return jsonResponse(res, 200, catalog);
  }

  const invListMatch = path.match(/^\/api\/inventory\/([^/]+)$/);
  if (invListMatch && req.method === "GET") {
    const category = decodeURIComponent(invListMatch[1]);
    return jsonResponse(res, 200, await listInventoryCategory(INSTALL_ROOT, PRIVATE_ROOT, category));
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

  if (path === "/api/research" && req.method === "GET") {
    return jsonResponse(res, 200, getResearchPayload(PRIVATE_ROOT));
  }

  if (path === "/api/research/suggestions" && req.method === "POST") {
    if (user === "api-token") {
      return jsonResponse(res, 403, { error: "session authentication required for suggestions" });
    }
    try {
      const body = /** @type {Record<string, unknown>} */ (await readJsonBody(req));
      const result = postResearchSuggestion(PRIVATE_ROOT, body, { user, sessionOnly: true });
      if (!result.ok) {
        return jsonResponse(res, result.status ?? 400, { error: result.error });
      }
      return jsonResponse(res, result.status ?? 201, { ok: true, suggestion: result.suggestion });
    } catch (e) {
      return jsonResponse(res, 400, { error: e instanceof Error ? e.message : String(e) });
    }
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
        privateRoot: PRIVATE_ROOT,
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
    if (!existsSync(DIST_ROOT)) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        `<!doctype html><html><head><meta charset="utf-8"><title>hdc-web-server</title></head><body style="font-family:system-ui;padding:2rem"><h1>hdc-web-server</h1><p>API is up (<code>/api/health</code>). UI build missing — run <code>npm run build</code> in <code>apps/hdc-web-server</code>.</p></body></html>`,
      );
      return;
    }
  }

  jsonResponse(res, 404, { error: "not found" });
}

function main() {
  const roots = resolveRoots();
  loadDotEnv(join(roots.metaRoot, ".env"));
  loadDotEnv(join(roots.hdcRoot, ".env"));

  // Re-resolve after dotenv
  const resolved = resolveRoots();
  const webConfig = loadWebConfig(resolved.metaRoot);
  if (webConfig.enabled === false) {
    process.stderr.write("[hdc-web-server] web UI disabled in web-config.json\n");
    process.exit(0);
  }

  mkdirSync(resolved.metaRoot, { recursive: true });
  ensureJobsDir(resolved.metaRoot);
  ensureLogDir(resolved.logDir);

  const sessionSecret = resolveSessionSecret();
  const apiToken = resolveApiToken();
  const oidc = resolveOidcConfig(process.env);
  const htpasswdAuth = bootstrapHtpasswdAuth(webConfig, resolved.metaRoot, sessionSecret);

  if (!sessionSecret && !htpasswdAuth.passwordLoginEnabled) {
    process.stderr.write(
      "[hdc-web-server] warning: HDC_WEB_UI_SESSION_SECRET not set — sessions disabled (legacy HDC_HDC_RUNNER_* also accepted)\n",
    );
  }
  const oidcPartial =
    Boolean(process.env.HDC_WEB_OIDC_ISSUER?.trim()) ||
    Boolean(process.env.HDC_WEB_OIDC_CLIENT_ID?.trim()) ||
    Boolean(process.env.HDC_WEB_OIDC_CLIENT_SECRET?.trim());
  if (oidcPartial && !oidc.configured) {
    process.stderr.write(
      "[hdc-web-server] warning: OIDC partially configured — set issuer, client id, client secret, and public URL or redirect URI for SSO\n",
    );
  } else if (!oidc.configured && !oidcPartial) {
    process.stderr.write("[hdc-web-server] OIDC not configured — SSO login disabled\n");
  }
  if (!apiToken) {
    process.stderr.write(
      "[hdc-web-server] warning: HDC_WEB_API_TOKEN not set — Bearer auth disabled\n",
    );
  }

  const host = webConfig.host ?? "0.0.0.0";
  const port = resolvePort(webConfig.port);

  const server = createServer((req, res) => {
    handleRequest(
      req,
      res,
      webConfig,
      resolved,
      sessionSecret,
      apiToken || undefined,
      oidc,
      htpasswdAuth,
    ).catch((e) => {
      jsonResponse(res, 500, { error: e instanceof Error ? e.message : String(e) });
    });
  });

  server.listen(port, host, () => {
    process.stderr.write(`[hdc-web-server] listening on http://${host}:${port}\n`);
    process.stderr.write(`[hdc-web-server] hdcRoot=${resolved.hdcRoot}\n`);
    process.stderr.write(`[hdc-web-server] privateRoot=${resolved.privateRoot}\n`);
    process.stderr.write(`[hdc-web-server] metaRoot=${resolved.metaRoot}\n`);
  });
}

main();
