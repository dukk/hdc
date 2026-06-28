/** @param {unknown} v */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * @param {Record<string, unknown>} paperclip
 */
export function normalizeImageTag(paperclip) {
  const t = typeof paperclip.image_tag === "string" ? paperclip.image_tag.trim() : "";
  if (!t) return "v2026.618.0";
  return t;
}

/**
 * @param {Record<string, unknown>} paperclip
 */
export function normalizePostgresImageTag(paperclip) {
  const t =
    typeof paperclip.postgres_image_tag === "string" ? paperclip.postgres_image_tag.trim() : "";
  if (!t) return "17-alpine";
  return t;
}

/**
 * @param {Record<string, unknown>} paperclip
 */
export function hostPort(paperclip) {
  const p = typeof paperclip.host_port === "number" ? paperclip.host_port : Number(paperclip.host_port);
  if (Number.isFinite(p) && p >= 1 && p <= 65535) return Math.floor(p);
  return 3100;
}

/**
 * @param {Record<string, unknown>} paperclip
 */
export function deploymentMode(paperclip) {
  const m = typeof paperclip.deployment_mode === "string" ? paperclip.deployment_mode.trim() : "";
  if (m === "local_trusted" || m === "authenticated") return m;
  return "authenticated";
}

/**
 * @param {Record<string, unknown>} paperclip
 */
export function deploymentExposure(paperclip) {
  const e = typeof paperclip.deployment_exposure === "string" ? paperclip.deployment_exposure.trim() : "";
  if (e === "private" || e === "public") return e;
  return "private";
}

/**
 * @param {Record<string, unknown>} paperclip
 */
export function telemetryDisabled(paperclip) {
  return paperclip.telemetry_disabled !== false;
}

/**
 * @param {Record<string, unknown>} paperclip
 */
export function betterAuthSecretVaultKey(paperclip) {
  const key =
    typeof paperclip.better_auth_secret_vault_key === "string" &&
    paperclip.better_auth_secret_vault_key.trim()
      ? paperclip.better_auth_secret_vault_key.trim()
      : "HDC_PAPERCLIP_BETTER_AUTH_SECRET";
  return key;
}

/**
 * @param {Record<string, unknown>} paperclip
 */
export function dbPasswordVaultKey(paperclip) {
  const key =
    typeof paperclip.db_password_vault_key === "string" && paperclip.db_password_vault_key.trim()
      ? paperclip.db_password_vault_key.trim()
      : "HDC_PAPERCLIP_DB_PASSWORD";
  return key;
}

/**
 * @param {Record<string, unknown>} paperclip
 * @returns {URL | null}
 */
export function parsePublicUrl(paperclip) {
  const raw = typeof paperclip.public_url === "string" ? paperclip.public_url.trim() : "";
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`paperclip.public_url is not a valid URL: ${JSON.stringify(raw)}`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("paperclip.public_url must use http:// or https://");
  }
  return parsed;
}

/**
 * @param {Record<string, unknown>} install
 */
export function composeDir(install) {
  return typeof install.compose_dir === "string" && install.compose_dir.trim()
    ? install.compose_dir.trim()
    : "/opt/paperclip";
}

const DB_USER = "paperclip";
const DB_NAME = "paperclip";

/**
 * @param {Record<string, unknown>} paperclip
 * @param {{ betterAuthSecret: string; dbPassword: string }} secrets
 * @param {string | null} [ctIp]
 */
export function renderPaperclipEnv(paperclip, secrets, ctIp = null) {
  const tag = normalizeImageTag(paperclip);
  const pgTag = normalizePostgresImageTag(paperclip);
  const port = hostPort(paperclip);
  const mode = deploymentMode(paperclip);
  const exposure = deploymentExposure(paperclip);
  const authSecret = String(secrets.betterAuthSecret || "").trim();
  const dbPassword = String(secrets.dbPassword || "").trim();
  if (!authSecret) {
    throw new Error("BETTER_AUTH_SECRET is required");
  }
  if (!dbPassword) {
    throw new Error("Paperclip DB password is required");
  }

  const parsed = parsePublicUrl(paperclip);
  const ip = typeof ctIp === "string" ? ctIp.trim() : "";
  const publicUrl = parsed
    ? parsed.origin.replace(/\/+$/, "")
    : ip
      ? `http://${ip}:${port}`
      : `http://localhost:${port}`;

  const lines = [
    "# hdc-generated — docker compose",
    `PAPERCLIP_IMAGE_TAG=${tag}`,
    `POSTGRES_IMAGE_TAG=${pgTag}`,
    `PAPERCLIP_HOST_PORT=${port}`,
    `POSTGRES_USER=${DB_USER}`,
    `POSTGRES_PASSWORD=${dbPassword}`,
    `POSTGRES_DB=${DB_NAME}`,
    `DATABASE_URL=postgres://${DB_USER}:${encodeURIComponent(dbPassword)}@db:5432/${DB_NAME}`,
    "PORT=3100",
    "HOST=0.0.0.0",
    "SERVE_UI=true",
    `PAPERCLIP_DEPLOYMENT_MODE=${mode}`,
    `PAPERCLIP_DEPLOYMENT_EXPOSURE=${exposure}`,
    `PAPERCLIP_PUBLIC_URL=${publicUrl}`,
    `BETTER_AUTH_SECRET=${authSecret}`,
    "NODE_ENV=production",
    "PAPERCLIP_HOME=/paperclip",
    "PAPERCLIP_INSTANCE_ID=default",
    "PAPERCLIP_CONFIG=/paperclip/instances/default/config.json",
  ];

  if (telemetryDisabled(paperclip)) {
    lines.push("PAPERCLIP_TELEMETRY_DISABLED=1", "DO_NOT_TRACK=1");
  }

  return `${lines.join("\n")}\n`;
}

export function renderComposeYaml() {
  return `services:
  db:
    image: postgres:\${POSTGRES_IMAGE_TAG}
    container_name: paperclip_db
    restart: unless-stopped
    ports:
      - "127.0.0.1:5432:5432"
    environment:
      POSTGRES_USER: \${POSTGRES_USER}
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: \${POSTGRES_DB}
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U paperclip -d paperclip"]
      interval: 2s
      timeout: 5s
      retries: 30
    volumes:
      - paperclip-pgdata:/var/lib/postgresql/data

  server:
    image: ghcr.io/paperclipai/paperclip:\${PAPERCLIP_IMAGE_TAG}
    container_name: paperclip_server
    restart: unless-stopped
    ports:
      - "\${PAPERCLIP_HOST_PORT}:3100"
    env_file:
      - .env
    volumes:
      - paperclip-data:/paperclip
    depends_on:
      db:
        condition: service_healthy

volumes:
  paperclip-pgdata:
  paperclip-data:
`;
}

/**
 * @param {Record<string, unknown>} paperclip
 * @param {string | null} [ctIp]
 */
export function resolveWebUrl(paperclip, ctIp = null) {
  const parsed = parsePublicUrl(paperclip);
  if (parsed) return parsed.origin.replace(/\/+$/, "");
  const port = hostPort(paperclip);
  const ip = typeof ctIp === "string" ? ctIp.trim() : "";
  if (ip) return `http://${ip}:${port}`;
  return null;
}

/**
 * @param {string | null} ctIp
 * @param {Record<string, unknown>} paperclip
 */
export function resolveUpstreamUrl(ctIp, paperclip) {
  const port = hostPort(paperclip);
  if (ctIp) return `http://${ctIp}:${port}`;
  return null;
}
