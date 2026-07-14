/**
 * OIDC Authorization Code BFF helpers (Keycloak / OpenID Provider).
 * Discovery + token + userinfo over fetch; state/PKCE via Node crypto.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const OIDC_STATE_COOKIE = "hdc_web_oidc";
const OIDC_STATE_TTL_MS = 10 * 60 * 1000;

/** @type {Map<string, { authorization_endpoint: string; token_endpoint: string; userinfo_endpoint: string; end_session_endpoint?: string; fetchedAt: number }>} */
const discoveryCache = new Map();
const DISCOVERY_TTL_MS = 15 * 60 * 1000;

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

/**
 * @param {NodeJS.ProcessEnv} [env]
 */
export function resolveOidcConfig(env = process.env) {
  const issuer = String(env.HDC_WEB_OIDC_ISSUER ?? "").trim().replace(/\/+$/, "");
  const clientId = String(env.HDC_WEB_OIDC_CLIENT_ID ?? "").trim();
  const clientSecret = String(env.HDC_WEB_OIDC_CLIENT_SECRET ?? "").trim();
  const publicUrl = String(env.HDC_WEB_PUBLIC_URL ?? "").trim().replace(/\/+$/, "");
  let redirectUri = String(env.HDC_WEB_OIDC_REDIRECT_URI ?? "").trim();
  if (!redirectUri && publicUrl) {
    redirectUri = `${publicUrl}/api/auth/oidc/callback`;
  }
  return {
    issuer,
    clientId,
    clientSecret,
    redirectUri,
    publicUrl,
    configured: Boolean(issuer && clientId && clientSecret && redirectUri),
  };
}

/**
 * @param {string} issuer
 * @param {{ fetchImpl?: typeof fetch }} [opts]
 */
export async function fetchOidcDiscovery(issuer, opts = {}) {
  const root = issuer.replace(/\/+$/, "");
  const cached = discoveryCache.get(root);
  if (cached && Date.now() - cached.fetchedAt < DISCOVERY_TTL_MS) {
    return cached;
  }
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const url = `${root}/.well-known/openid-configuration`;
  const res = await fetchImpl(url, { headers: { Accept: "application/json" } });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`OIDC discovery failed (HTTP ${res.status})`);
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("OIDC discovery response was not JSON");
  }
  const authorization_endpoint =
    typeof parsed.authorization_endpoint === "string" ? parsed.authorization_endpoint : "";
  const token_endpoint = typeof parsed.token_endpoint === "string" ? parsed.token_endpoint : "";
  const userinfo_endpoint =
    typeof parsed.userinfo_endpoint === "string" ? parsed.userinfo_endpoint : "";
  if (!authorization_endpoint || !token_endpoint || !userinfo_endpoint) {
    throw new Error("OIDC discovery missing authorization/token/userinfo endpoints");
  }
  /** @type {{ authorization_endpoint: string; token_endpoint: string; userinfo_endpoint: string; end_session_endpoint?: string; fetchedAt: number }} */
  const doc = {
    authorization_endpoint,
    token_endpoint,
    userinfo_endpoint,
    fetchedAt: Date.now(),
  };
  if (typeof parsed.end_session_endpoint === "string" && parsed.end_session_endpoint.trim()) {
    doc.end_session_endpoint = parsed.end_session_endpoint.trim();
  }
  discoveryCache.set(root, doc);
  return doc;
}

/** Clear discovery cache (tests). */
export function clearOidcDiscoveryCache() {
  discoveryCache.clear();
}

/**
 * @returns {{ state: string; codeVerifier: string; codeChallenge: string }}
 */
export function createOidcLoginState() {
  const state = randomBytes(24).toString("base64url");
  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  return { state, codeVerifier, codeChallenge };
}

/**
 * @param {{ state: string; codeVerifier: string }} payload
 * @param {string} sessionSecret
 */
export function encodeOidcStateCookie(payload, sessionSecret) {
  const body = JSON.stringify({
    state: payload.state,
    codeVerifier: payload.codeVerifier,
    exp: Date.now() + OIDC_STATE_TTL_MS,
  });
  const encoded = Buffer.from(body).toString("base64url");
  const sig = createHmac("sha256", sessionSecret).update(encoded).digest("base64url");
  return `${encoded}.${sig}`;
}

/**
 * @param {string | undefined} cookieValue
 * @param {string} sessionSecret
 * @returns {{ state: string; codeVerifier: string } | null}
 */
export function decodeOidcStateCookie(cookieValue, sessionSecret) {
  if (!cookieValue || !sessionSecret) return null;
  const parts = cookieValue.split(".");
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const expected = createHmac("sha256", sessionSecret).update(encoded).digest("base64url");
  if (!safeEqualString(sig, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (!payload || typeof payload.state !== "string" || typeof payload.codeVerifier !== "string") {
      return null;
    }
    if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    return { state: payload.state, codeVerifier: payload.codeVerifier };
  } catch {
    return null;
  }
}

/**
 * @param {string} cookieValue
 */
export function oidcStateSetCookieHeader(cookieValue) {
  return `${OIDC_STATE_COOKIE}=${encodeURIComponent(cookieValue)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${Math.floor(OIDC_STATE_TTL_MS / 1000)}`;
}

export function oidcStateClearCookieHeader() {
  return `${OIDC_STATE_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`;
}

/**
 * @param {{
 *   authorizationEndpoint: string;
 *   clientId: string;
 *   redirectUri: string;
 *   state: string;
 *   codeChallenge: string;
 * }} opts
 */
export function buildAuthorizeUrl(opts) {
  const u = new URL(opts.authorizationEndpoint);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", opts.clientId);
  u.searchParams.set("redirect_uri", opts.redirectUri);
  u.searchParams.set("scope", "openid profile email");
  u.searchParams.set("state", opts.state);
  u.searchParams.set("code_challenge", opts.codeChallenge);
  u.searchParams.set("code_challenge_method", "S256");
  return u.toString();
}

/**
 * @param {{
 *   tokenEndpoint: string;
 *   code: string;
 *   redirectUri: string;
 *   clientId: string;
 *   clientSecret: string;
 *   codeVerifier: string;
 *   fetchImpl?: typeof fetch;
 * }} opts
 */
export async function exchangeAuthorizationCode(opts) {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: opts.code,
    redirect_uri: opts.redirectUri,
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    code_verifier: opts.codeVerifier,
  });
  const res = await fetchImpl(opts.tokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    const preview = text.length > 200 ? `${text.slice(0, 200)}…` : text;
    throw new Error(`OIDC token exchange failed (HTTP ${res.status})${preview ? `: ${preview}` : ""}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("OIDC token response was not JSON");
  }
  const accessToken =
    parsed && typeof parsed.access_token === "string" ? parsed.access_token : "";
  if (!accessToken) throw new Error("OIDC token response missing access_token");
  return {
    access_token: accessToken,
    id_token: typeof parsed.id_token === "string" ? parsed.id_token : "",
  };
}

/**
 * @param {{
 *   userinfoEndpoint: string;
 *   accessToken: string;
 *   fetchImpl?: typeof fetch;
 * }} opts
 */
export async function fetchOidcUserinfo(opts) {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const res = await fetchImpl(opts.userinfoEndpoint, {
    headers: {
      Authorization: `Bearer ${opts.accessToken}`,
      Accept: "application/json",
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`OIDC userinfo failed (HTTP ${res.status})`);
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("OIDC userinfo response was not JSON");
  }
  return parsed && typeof parsed === "object" ? /** @type {Record<string, unknown>} */ (parsed) : {};
}

/**
 * Prefer preferred_username, then email, then sub.
 * @param {Record<string, unknown>} userinfo
 */
export function usernameFromUserinfo(userinfo) {
  for (const key of ["preferred_username", "email", "sub"]) {
    const v = userinfo[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

/**
 * @param {{
 *   endSessionEndpoint: string;
 *   clientId: string;
 *   postLogoutRedirectUri: string;
 *   idTokenHint?: string;
 * }} opts
 */
export function buildEndSessionUrl(opts) {
  const u = new URL(opts.endSessionEndpoint);
  u.searchParams.set("client_id", opts.clientId);
  u.searchParams.set("post_logout_redirect_uri", opts.postLogoutRedirectUri);
  if (opts.idTokenHint) {
    u.searchParams.set("id_token_hint", opts.idTokenHint);
  }
  return u.toString();
}

/**
 * Verify returned OIDC state matches cookie.
 * @param {string} returnedState
 * @param {string} expectedState
 */
export function oidcStatesMatch(returnedState, expectedState) {
  if (!returnedState || !expectedState) return false;
  return safeEqualString(returnedState, expectedState);
}
