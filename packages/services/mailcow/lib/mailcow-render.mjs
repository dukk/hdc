/** @param {unknown} v */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * @param {Record<string, unknown>} mailcow
 */
export function normalizeHostname(mailcow) {
  const h = typeof mailcow.hostname === "string" ? mailcow.hostname.trim() : "";
  if (!h) {
    throw new Error("mailcow.hostname is required (FQDN for MAILCOW_HOSTNAME)");
  }
  const dots = (h.match(/\./g) || []).length;
  if (dots < 1) {
    throw new Error(`mailcow.hostname ${JSON.stringify(h)} must be a FQDN`);
  }
  if (h.endsWith(".")) {
    throw new Error(`mailcow.hostname ${JSON.stringify(h)} must not end with a dot`);
  }
  return h;
}

/**
 * @param {Record<string, unknown>} mailcow
 */
export function normalizeTimezone(mailcow) {
  const tz = typeof mailcow.timezone === "string" && mailcow.timezone.trim()
    ? mailcow.timezone.trim()
    : "Etc/UTC";
  return tz;
}

/**
 * @param {Record<string, unknown>} mailcow
 */
export function normalizeGitRef(mailcow) {
  const ref = typeof mailcow.git_ref === "string" && mailcow.git_ref.trim()
    ? mailcow.git_ref.trim()
    : "master";
  return ref;
}

/**
 * @param {Record<string, unknown>} install
 */
export function installDir(install) {
  return typeof install.install_dir === "string" && install.install_dir.trim()
    ? install.install_dir.trim()
    : "/opt/mailcow-dockerized";
}

/**
 * @param {Record<string, unknown>} mailcow
 */
export function apiKeyVaultKey(mailcow) {
  return typeof mailcow.api_key_vault_key === "string" && mailcow.api_key_vault_key.trim()
    ? mailcow.api_key_vault_key.trim()
    : "HDC_MAILCOW_API_KEY";
}

/**
 * @param {Record<string, unknown>} mailcow
 */
export function dbpassVaultKey(mailcow) {
  return typeof mailcow.dbpass_vault_key === "string" && mailcow.dbpass_vault_key.trim()
    ? mailcow.dbpass_vault_key.trim()
    : "HDC_MAILCOW_DBPASS";
}

/**
 * @param {Record<string, unknown>} mailcow
 */
export function dbrootVaultKey(mailcow) {
  return typeof mailcow.dbroot_vault_key === "string" && mailcow.dbroot_vault_key.trim()
    ? mailcow.dbroot_vault_key.trim()
    : "HDC_MAILCOW_DBROOT";
}

/**
 * @param {Record<string, unknown>} mailcow
 */
export function redispassVaultKey(mailcow) {
  return typeof mailcow.redispass_vault_key === "string" && mailcow.redispass_vault_key.trim()
    ? mailcow.redispass_vault_key.trim()
    : "HDC_MAILCOW_REDISPASS";
}

/**
 * @param {Record<string, unknown>} mailcow
 */
export function resolveAdminUrl(mailcow) {
  const explicit =
    typeof mailcow.admin_url === "string" && mailcow.admin_url.trim()
      ? mailcow.admin_url.trim().replace(/\/+$/, "")
      : "";
  if (explicit) return explicit;
  return `https://${normalizeHostname(mailcow)}`;
}

/**
 * @param {Record<string, unknown>} mailcow
 */
export function resolveApiBaseUrl(mailcow) {
  const explicit =
    typeof mailcow.api_url === "string" && mailcow.api_url.trim()
      ? mailcow.api_url.trim().replace(/\/+$/, "")
      : "";
  if (explicit) return explicit;
  try {
    return `https://${normalizeHostname(mailcow)}`;
  } catch {
    return resolveAdminUrl(mailcow);
  }
}

/**
 * @param {Record<string, unknown>} mailcow
 */
export function cloudflareDkimPublishEnabled(mailcow) {
  const dnsPublish = isObject(mailcow.dns_publish) ? mailcow.dns_publish : {};
  if (dnsPublish.cloudflare_dkim === false) return false;
  return true;
}

/**
 * @param {Record<string, unknown>} mailcow
 * @returns {import("./mailcow-dns.mjs").MailcowDomainConfig[]}
 */
export function normalizeDomainList(mailcow) {
  const raw = mailcow.domains;
  if (!Array.isArray(raw)) return [];
  /** @type {import("./mailcow-dns.mjs").MailcowDomainConfig[]} */
  const out = [];
  for (const item of raw) {
    if (!isObject(item)) continue;
    const name = typeof item.name === "string" ? item.name.trim() : "";
    if (!name) continue;
    const outbound = isObject(item.outbound) ? item.outbound : {};
    const modeRaw = typeof outbound.mode === "string" ? outbound.mode.trim() : "direct";
    const mode = modeRaw === "postfix-relay" ? "postfix-relay" : "direct";
    const dns = isObject(item.dns) ? item.dns : {};
    const selector =
      typeof item.dkim_selector === "string" && item.dkim_selector.trim()
        ? item.dkim_selector.trim()
        : "dkim";
    const keySizeRaw = item.dkim_key_size;
    const keySize =
      keySizeRaw === 1024 || keySizeRaw === "1024" ? 1024 : 2048;
    out.push({
      name,
      description:
        typeof item.description === "string" ? item.description.trim() : "",
      dkim_selector: selector,
      dkim_key_size: keySize,
      outbound_mode: mode,
      dns: {
        mx_priority:
          typeof dns.mx_priority === "number" && Number.isFinite(dns.mx_priority)
            ? Math.floor(dns.mx_priority)
            : 10,
        spf: typeof dns.spf === "string" ? dns.spf.trim() : "",
        dmarc: typeof dns.dmarc === "string" ? dns.dmarc.trim() : "",
        notes: typeof dns.notes === "string" ? dns.notes.trim() : "",
      },
    });
  }
  return out;
}

/**
 * @param {Record<string, unknown>} mailcow
 * @param {{ dbpass: string; dbroot: string; redispass: string }} secrets
 */
export function buildGenerateConfigEnv(mailcow, secrets) {
  const hostname = normalizeHostname(mailcow);
  const tz = normalizeTimezone(mailcow);
  /** @type {Record<string, string>} */
  const env = {
    MAILCOW_HOSTNAME: hostname,
    MAILCOW_TZ: tz,
    MAILCOW_DBPASS: secrets.dbpass,
    MAILCOW_DBROOT: secrets.dbroot,
    MAILCOW_REDISPASS: secrets.redispass,
  };
  if (mailcow.skip_clamd === true) env.SKIP_CLAMD = "y";
  if (mailcow.skip_solr === true) env.SKIP_SOLR = "y";
  return env;
}

/**
 * @param {Record<string, string>} env
 */
export function shellExportEnv(env) {
  return Object.entries(env)
    .map(([k, v]) => `export ${k}=${JSON.stringify(v)}`)
    .join("\n");
}

/**
 * @param {string} dirPath
 * @param {string} gitRef
 * @param {Record<string, string>} genEnv
 * @param {{ dataDiskMountScript?: string; dockerDataRoot?: string }} [opts]
 */
export function buildInstallScript(dirPath, gitRef, genEnv, opts = {}) {
  const dir = dirPath.replace(/'/g, `'\\''`);
  const ref = gitRef.replace(/'/g, `'\\''`);
  const envBlock = shellExportEnv(genEnv);
  const { dataDiskMountScript, dockerDataRoot } = opts;

  const lines = [
    "set -euo pipefail",
    "export DEBIAN_FRONTEND=noninteractive",
  ];
  if (dataDiskMountScript) {
    lines.push(dataDiskMountScript);
  }
  if (dockerDataRoot) {
    const dr = dockerDataRoot.replace(/'/g, `'\\''`);
    lines.push(`mkdir -p '${dr}'`);
  }
  lines.push(
    "apt-get update -qq",
    "apt-get install -y -qq ca-certificates curl git gnupg",
    "if ! command -v docker >/dev/null 2>&1; then",
    "  install -m 0755 -d /etc/apt/keyrings",
    "  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc",
    "  chmod a+r /etc/apt/keyrings/docker.asc",
    '  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo ${VERSION_CODENAME:-$VERSION_ID}) stable" > /etc/apt/sources.list.d/docker.list',
    "  apt-get update -qq",
    "  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin",
    "fi",
  );
  if (dockerDataRoot) {
    const dr = dockerDataRoot.replace(/'/g, `'\\''`);
    lines.push(
      "install -d /etc/docker",
      `printf '%s\\n' '{"data-root": "${dr}"}' > /etc/docker/daemon.json`,
      "if systemctl is-active --quiet docker 2>/dev/null; then systemctl stop docker; fi",
      "if [ -d /var/lib/docker ] && [ ! -L /var/lib/docker ]; then rm -rf /var/lib/docker/* 2>/dev/null || true; fi",
    );
  }
  lines.push(
    "systemctl enable --now docker",
    `mkdir -p '${dir}'`,
    `if ! test -d '${dir}/.git'; then`,
    `  git clone https://github.com/mailcow/mailcow-dockerized '${dir}'`,
    "fi",
    `cd '${dir}'`,
    `git fetch --tags origin`,
    `git checkout '${ref}' 2>/dev/null || git checkout origin/'${ref}' 2>/dev/null || git checkout master`,
    envBlock,
    "if ! test -f mailcow.conf; then",
    "  printf 'y\\n' | ./generate_config.sh",
    "fi",
    "docker compose pull",
    "docker compose up -d",
    "docker compose ps",
  );
  return lines.join("\n");
}

/**
 * @param {Record<string, unknown>} mailcow
 * @returns {string[]}
 */
export function reverseProxyTrustedProxies(mailcow) {
  const rp = isObject(mailcow.reverse_proxy) ? mailcow.reverse_proxy : {};
  const raw = Array.isArray(rp.trusted_proxies) ? rp.trusted_proxies : [];
  return raw
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter(Boolean);
}

/**
 * @param {Record<string, unknown>} mailcow
 * @returns {string[]}
 */
export function reverseProxyAdditionalServerNames(mailcow) {
  const rp = isObject(mailcow.reverse_proxy) ? mailcow.reverse_proxy : {};
  const explicit = Array.isArray(rp.additional_server_names) ? rp.additional_server_names : [];
  const fromExplicit = explicit
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter(Boolean);
  if (fromExplicit.length) return fromExplicit;
  return normalizeDomainList(mailcow).map((d) => `mail.${d.name}`);
}

/**
 * @param {string} dirPath
 * @param {Record<string, unknown>} mailcow
 * @returns {string | null}
 */
export function buildReverseProxyConfScript(dirPath, mailcow) {
  const trusted = reverseProxyTrustedProxies(mailcow);
  const additional = reverseProxyAdditionalServerNames(mailcow);
  if (!trusted.length && !additional.length) return null;

  const dir = dirPath.replace(/'/g, `'\\''`);
  const trustedVal = trusted.join(",").replace(/'/g, `'\\''`);
  const additionalVal = additional.join(",").replace(/'/g, `'\\''`);

  /** @type {string[]} */
  const lines = [
    "set -euo pipefail",
    `cd '${dir}'`,
    "test -f mailcow.conf",
    `set_kv() {`,
    `  key="$1"`,
    `  val="$2"`,
    `  if grep -q "^$key=" mailcow.conf; then`,
    `    sed -i "s|^$key=.*|$key=$val|" mailcow.conf`,
    `  else`,
    `    printf '%s=%s\\n' "$key" "$val" >> mailcow.conf`,
    `  fi`,
    `}`,
  ];
  if (trusted.length) {
    lines.push(`set_kv TRUSTED_PROXIES '${trustedVal}'`);
  }
  if (additional.length) {
    lines.push(`set_kv ADDITIONAL_SERVER_NAMES '${additionalVal}'`);
  }
  return lines.join("\n");
}

/**
 * @param {string} dirPath
 * @param {{ skipUpgrade?: boolean }} [opts]
 */
export function buildMaintainScript(dirPath, opts = {}) {
  const dir = dirPath.replace(/'/g, `'\\''`);
  const lines = [
    "set -euo pipefail",
    `test -d '${dir}'`,
    `cd '${dir}'`,
    `test -f mailcow.conf`,
  ];
  if (!opts.skipUpgrade) {
    lines.push("docker compose pull");
  }
  lines.push("docker compose up -d", "docker compose ps");
  return lines.join("\n");
}

/**
 * @param {string} dirPath
 */
export function buildComposeDownScript(dirPath) {
  const dir = dirPath.replace(/'/g, `'\\''`);
  return [
    "set -euo pipefail",
    `if test -f '${dir}/mailcow.conf'; then`,
    `  cd '${dir}' && docker compose down 2>/dev/null || true`,
    "fi",
  ].join("\n");
}
