import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const SESSION_COOKIE = "hdc_web_session";
const LEGACY_SESSION_COOKIE = "hdc_runner_session";
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

/** @type {{ count: number; windowStart: number }[]} */
const loginAttempts = [];

/**
 * @param {string} a
 * @param {string} b
 */
function safeEqualString(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function isLoginRateLimited() {
  const now = Date.now();
  while (loginAttempts.length && now - loginAttempts[0].windowStart > LOGIN_WINDOW_MS) {
    loginAttempts.shift();
  }
  const recent = loginAttempts.filter((e) => now - e.windowStart <= LOGIN_WINDOW_MS);
  return recent.length >= MAX_LOGIN_ATTEMPTS;
}

export function recordLoginFailure() {
  loginAttempts.push({ count: 1, windowStart: Date.now() });
}

/**
 * @param {string} username
 * @param {string} sessionSecret
 */
export function createSessionToken(username, sessionSecret) {
  const payload = JSON.stringify({
    user: username,
    exp: Date.now() + SESSION_TTL_MS,
    nonce: randomBytes(8).toString("hex"),
  });
  const encoded = Buffer.from(payload).toString("base64url");
  const sig = createHmac("sha256", sessionSecret).update(encoded).digest("base64url");
  return `${encoded}.${sig}`;
}

/**
 * @param {string | undefined} token
 * @param {string} sessionSecret
 * @returns {string | null} username
 */
export function verifySessionToken(token, sessionSecret) {
  if (!token || !sessionSecret) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const expected = createHmac("sha256", sessionSecret).update(encoded).digest("base64url");
  if (!safeEqualString(sig, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (!payload || typeof payload.user !== "string") return null;
    if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    return payload.user;
  } catch {
    return null;
  }
}

/**
 * @param {import("node:http").IncomingMessage} req
 */
export function parseCookies(req) {
  const raw = req.headers.cookie ?? "";
  /** @type {Record<string, string>} */
  const out = {};
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  }
  return out;
}

/**
 * @param {string} token
 */
export function sessionSetCookieHeader(token) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`;
}

export function sessionClearCookieHeader() {
  return `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0`;
}

export { SESSION_COOKIE, LEGACY_SESSION_COOKIE };

/**
 * @param {string} username
 * @param {string} password
 * @param {string} expectedUser
 * @param {string} expectedPassword
 */
export function validateLogin(username, password, expectedUser, expectedPassword) {
  if (!username || !password || !expectedPassword) return false;
  return safeEqualString(username, expectedUser) && safeEqualString(password, expectedPassword);
}

/**
 * @param {string | string[] | undefined} authHeader
 * @param {string} expectedToken
 * @returns {boolean}
 */
export function verifyBearerToken(authHeader, expectedToken) {
  if (!expectedToken) return false;
  const raw = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  if (!raw || typeof raw !== "string") return false;
  const match = /^Bearer\s+(.+)$/i.exec(raw.trim());
  if (!match) return false;
  return safeEqualString(match[1].trim(), expectedToken);
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {string} sessionSecret
 * @param {string} [apiToken]
 * @returns {string | null} username or "api-token"
 */
export function resolveAuthUser(req, sessionSecret, apiToken) {
  if (apiToken && verifyBearerToken(req.headers.authorization, apiToken)) {
    return "api-token";
  }
  const cookies = parseCookies(req);
  return (
    verifySessionToken(cookies[SESSION_COOKIE], sessionSecret) ||
    verifySessionToken(cookies[LEGACY_SESSION_COOKIE], sessionSecret)
  );
}
