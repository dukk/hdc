/**
 * Env helpers: prefer HDC_WEB_* with legacy HDC_HDC_RUNNER_* / HDC_RUNNER_* fallbacks.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * @param {...string} keys
 * @returns {string}
 */
export function envFirst(...keys) {
  for (const key of keys) {
    const v = process.env[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

/**
 * @returns {{ hdcRoot: string; privateRoot: string; metaRoot: string; logDir: string }}
 */
export function resolveRoots() {
  const hdcRoot =
    envFirst("HDC_ROOT", "HDC_RUNNER_INSTALL_ROOT") || join(here, "..", "..", "..");

  let privateRoot = envFirst("HDC_PRIVATE_ROOT", "HDC_RUNNER_PRIVATE_ROOT");
  if (!privateRoot) {
    const sibling = join(hdcRoot, "..", "hdc-private");
    privateRoot = existsSync(sibling) ? sibling : hdcRoot;
  }

  const metaRoot =
    envFirst("HDC_WEB_META_ROOT", "HDC_AGENTS_META_ROOT", "HDC_RUNNER_META_ROOT") ||
    join(homedir(), ".hdc", "web-meta");

  const logDir =
    envFirst("HDC_WEB_LOG_DIR", "HDC_RUNNER_LOG_DIR") || join(metaRoot, "logs");

  return { hdcRoot, privateRoot, metaRoot, logDir };
}

export function resolveUiPassword() {
  return envFirst("HDC_WEB_UI_PASSWORD", "HDC_HDC_RUNNER_UI_PASSWORD");
}

export function resolveSessionSecret() {
  return envFirst("HDC_WEB_UI_SESSION_SECRET", "HDC_HDC_RUNNER_UI_SESSION_SECRET");
}

export function resolveApiToken() {
  return envFirst("HDC_WEB_API_TOKEN", "HDC_HDC_RUNNER_API_TOKEN");
}

export function resolvePublicUrl() {
  return envFirst("HDC_WEB_PUBLIC_URL");
}

export function resolveOidcIssuer() {
  return envFirst("HDC_WEB_OIDC_ISSUER");
}

export function resolveOidcClientId() {
  return envFirst("HDC_WEB_OIDC_CLIENT_ID");
}

export function resolveOidcClientSecret() {
  return envFirst("HDC_WEB_OIDC_CLIENT_SECRET");
}

export function resolveOidcRedirectUri() {
  return envFirst("HDC_WEB_OIDC_REDIRECT_URI");
}

export function resolvePort(webConfigPort) {
  const fromEnv = envFirst("HDC_WEB_PORT", "PORT");
  if (fromEnv) {
    const n = Number(fromEnv);
    if (Number.isFinite(n) && n > 0) return n;
  }
  if (typeof webConfigPort === "number" && webConfigPort > 0) return webConfigPort;
  return 9120;
}
