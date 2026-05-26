/** @param {unknown} v */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * @param {unknown} backends
 * @returns {{ id: string; url: string }[]}
 */
export function normalizeOllamaBackends(backends) {
  if (!Array.isArray(backends) || backends.length === 0) {
    throw new Error("open_webui.ollama_backends must be a non-empty array");
  }
  /** @type {{ id: string; url: string }[]} */
  const out = [];
  const seen = new Set();
  for (const raw of backends) {
    if (!isObject(raw)) continue;
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    const url = typeof raw.url === "string" ? raw.url.trim() : "";
    if (!id || !url) {
      throw new Error("each ollama_backends entry needs id and url");
    }
    if (!/^https?:\/\//i.test(url)) {
      throw new Error(`ollama_backends ${JSON.stringify(id)}: url must be http(s)://…`);
    }
    if (seen.has(id)) {
      throw new Error(`duplicate ollama_backends id ${JSON.stringify(id)}`);
    }
    seen.add(id);
    out.push({ id, url });
  }
  if (!out.length) {
    throw new Error("open_webui.ollama_backends must contain at least one valid entry");
  }
  return out;
}

/**
 * @param {{ id: string; url: string }[]} backends
 */
export function ollamaBaseUrlsJoined(backends) {
  return backends.map((b) => b.url).join(";");
}

/**
 * @param {Record<string, unknown>} openWebui
 */
export function normalizeImageTag(openWebui) {
  const t = typeof openWebui.image_tag === "string" ? openWebui.image_tag.trim() : "";
  if (!t) return "main";
  return t;
}

/**
 * @param {Record<string, unknown>} openWebui
 */
export function hostPort(openWebui) {
  const p = typeof openWebui.host_port === "number" ? openWebui.host_port : Number(openWebui.host_port);
  if (Number.isFinite(p) && p >= 1 && p <= 65535) return Math.floor(p);
  return 3000;
}

/**
 * @param {Record<string, unknown>} install
 */
export function composeDir(install) {
  return typeof install.compose_dir === "string" && install.compose_dir.trim()
    ? install.compose_dir.trim()
    : "/opt/open-webui";
}

/**
 * @param {Record<string, unknown>} openWebui
 */
export function secretKeyVaultKey(openWebui) {
  const key =
    typeof openWebui.secret_key_vault_key === "string" && openWebui.secret_key_vault_key.trim()
      ? openWebui.secret_key_vault_key.trim()
      : "HDC_OPEN_WEBUI_SECRET_KEY";
  return key;
}

/**
 * @param {Record<string, unknown>} openWebui
 * @param {string} secretKey
 */
export function renderOpenWebuiEnv(openWebui, secretKey) {
  const backends = normalizeOllamaBackends(openWebui.ollama_backends);
  const tag = normalizeImageTag(openWebui);
  const port = hostPort(openWebui);
  const urls = ollamaBaseUrlsJoined(backends);
  const primary = backends[0].url;
  const webuiAuth = openWebui.webui_auth !== false;

  const lines = [
    `# hdc-generated — docker compose`,
    `OPEN_WEBUI_IMAGE_TAG=${tag}`,
    `OPEN_WEBUI_HOST_PORT=${port}`,
    `OLLAMA_BASE_URL=${primary}`,
    `OLLAMA_BASE_URLS=${urls}`,
    `WEBUI_SECRET_KEY=${secretKey}`,
    "K8S_FLAG=false",
    "SCARF_NO_ANALYTICS=true",
    "DO_NOT_TRACK=true",
    "ANONYMIZED_TELEMETRY=false",
    `WEBUI_AUTH=${webuiAuth ? "true" : "false"}`,
  ];
  return `${lines.join("\n")}\n`;
}

/**
 * Minimal compose: Open WebUI only (no bundled Ollama).
 */
export function renderComposeYaml() {
  return `services:
  open-webui:
    image: ghcr.io/open-webui/open-webui:\${OPEN_WEBUI_IMAGE_TAG}
    container_name: open-webui
    restart: unless-stopped
    ports:
      - "\${OPEN_WEBUI_HOST_PORT}:8080"
    volumes:
      - open-webui:/app/backend/data
    env_file:
      - .env

volumes:
  open-webui: {}
`;
}

/**
 * @param {string | null} ctIp
 * @param {Record<string, unknown>} openWebui
 */
export function resolveWebUiUrl(ctIp, openWebui) {
  const port = hostPort(openWebui);
  if (typeof openWebui.public_url === "string" && openWebui.public_url.trim()) {
    return openWebui.public_url.trim();
  }
  if (ctIp) return `http://${ctIp}:${port}`;
  return null;
}
