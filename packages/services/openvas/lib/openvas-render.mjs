/** @param {unknown} v */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * @param {Record<string, unknown>} openvas
 */
export function imageTag(openvas) {
  const t = typeof openvas.image_tag === "string" ? openvas.image_tag.trim() : "";
  return t || "stable";
}

/**
 * @param {Record<string, unknown>} openvas
 */
export function hostPort(openvas) {
  const p = typeof openvas.host_port === "number" ? openvas.host_port : Number(openvas.host_port);
  if (Number.isFinite(p) && p >= 1 && p <= 65535) return Math.floor(p);
  return 3000;
}

/**
 * @param {Record<string, unknown>} openvas
 */
export function adminUser(openvas) {
  const user = typeof openvas.admin_user === "string" ? openvas.admin_user.trim() : "";
  return user || "admin";
}

/**
 * @param {Record<string, unknown>} openvas
 */
export function adminPasswordVaultKey(openvas) {
  const key =
    typeof openvas.admin_password_vault_key === "string" && openvas.admin_password_vault_key.trim()
      ? openvas.admin_password_vault_key.trim()
      : "HDC_OPENVAS_ADMIN_PASSWORD";
  return key;
}

/**
 * @param {Record<string, unknown>} install
 */
export function composeDir(install) {
  return typeof install.compose_dir === "string" && install.compose_dir.trim()
    ? install.compose_dir.trim()
    : "/opt/openvas";
}

/**
 * @param {Record<string, unknown>} openvas
 * @param {string} adminPassword
 */
export function renderOpenvasEnv(openvas, adminPassword) {
  const lines = [
    "# hdc-generated — docker compose",
    `OPENVAS_IMAGE_TAG=${imageTag(openvas)}`,
    `OPENVAS_HOST_PORT=${hostPort(openvas)}`,
    `OPENVAS_ADMIN_USER=${adminUser(openvas)}`,
    `OPENVAS_ADMIN_PASSWORD=${adminPassword}`,
  ];
  return `${lines.join("\n")}\n`;
}

/**
 * @param {Record<string, unknown>} openvas
 */
export function renderComposeYaml(openvas) {
  const _cfg = isObject(openvas) ? openvas : {};
  return `services:
  openvas:
    image: greenbone/community-edition:\${OPENVAS_IMAGE_TAG}
    restart: unless-stopped
    ports:
      - "\${OPENVAS_HOST_PORT}:3000"
    env_file:
      - .env
    volumes:
      - openvas-data:/data

volumes:
  openvas-data: {}
`;
}
