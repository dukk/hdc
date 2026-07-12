import { stderr as errout } from "node:process";

import { pctExec } from "../../../lib/pve-pct-remote.mjs";
import { resolvePveSshForHost, waitForCt } from "../../ollama/lib/ollama-install.mjs";
import { normalizeVersionTag } from "./deployments.mjs";

export { resolvePveSshForHost, waitForCt };

const GITHUB_RELEASES = "https://api.github.com/repos/solidtime-io/solidtime/releases/latest";

/**
 * @param {string} tag e.g. v0.12.2
 */
export function releaseTarballUrl(tag) {
  const normalized = normalizeVersionTag(tag);
  return `https://github.com/solidtime-io/solidtime/archive/refs/tags/${normalized}.tar.gz`;
}

/**
 * @param {string} value
 */
function shellSingleQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

/**
 * @param {Record<string, unknown>} solidtime
 * @param {string} dbPassword
 */
export function buildInstallScript(solidtime, dbPassword) {
  const version = normalizeVersionTag(
    typeof solidtime.version === "string" ? solidtime.version : "v0.12.2",
  );
  const tarballUrl = releaseTarballUrl(version);
  const appUrl =
    typeof solidtime.app_url === "string" && solidtime.app_url.trim() ? solidtime.app_url.trim() : "";
  const enableRegistration = solidtime.enable_registration !== false;
  const mailMailer =
    typeof solidtime.mail_mailer === "string" && solidtime.mail_mailer.trim()
      ? solidtime.mail_mailer.trim()
      : "log";

  const qVersion = shellSingleQuote(version);
  const qTarball = shellSingleQuote(tarballUrl);
  const qDbPass = shellSingleQuote(dbPassword);
  const qAppUrl = shellSingleQuote(appUrl);
  const qMail = shellSingleQuote(mailMailer);
  const qReg = enableRegistration ? "true" : "false";

  return [
    "set -euo pipefail",
    "export DEBIAN_FRONTEND=noninteractive",
    "export GNUPGHOME=$(mktemp -d)",
    "chmod 700 \"$GNUPGHOME\"",
    "",
    "apt-get update -qq",
    "apt-get install -y -qq curl ca-certificates gnupg lsb-release apt-transport-https software-properties-common",
    "",
    "install -d -m 0755 /usr/share/keyrings",
    "curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg",
    "curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null",
    "apt-get update -qq",
    "apt-get install -y -qq caddy",
    "",
    "add-apt-repository -y ppa:ondrej/php || true",
    "apt-get update -qq",
    "apt-get install -y -qq php8.3-cli php8.3-fpm php8.3-bcmath php8.3-gd php8.3-intl php8.3-xml php8.3-zip php8.3-pgsql php8.3-redis php8.3-mbstring php8.3-curl",
    "",
    "curl -sS https://getcomposer.org/installer | php -- --install-dir=/usr/local/bin --filename=composer",
    "chmod +x /usr/local/bin/composer",
    'export PATH="/usr/local/bin:$PATH"',
    "",
    "curl -fsSL https://deb.nodesource.com/setup_22.x | bash -",
    "apt-get install -y -qq nodejs",
    "",
    "curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --batch --yes --dearmor -o /usr/share/keyrings/postgresql-keyring.gpg",
    'echo "deb [signed-by=/usr/share/keyrings/postgresql-keyring.gpg] http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list',
    "apt-get update -qq",
    "apt-get install -y -qq postgresql-16",
    "",
    `export HDC_DB_PASS=${qDbPass}`,
    "sudo -u postgres psql -tc \"SELECT 1 FROM pg_roles WHERE rolname = 'solidtime'\" | grep -q 1 || sudo -u postgres psql -c \"CREATE USER solidtime WITH PASSWORD '$HDC_DB_PASS'\"",
    "sudo -u postgres psql -c \"ALTER USER solidtime WITH PASSWORD '$HDC_DB_PASS'\"",
    "sudo -u postgres psql -tc \"SELECT 1 FROM pg_database WHERE datname = 'solidtime'\" | grep -q 1 || sudo -u postgres psql -c \"CREATE DATABASE solidtime OWNER solidtime\"",
    "",
    "rm -rf /opt/solidtime",
    "mkdir -p /opt/solidtime",
    `curl -fsSL ${qTarball} -o /tmp/solidtime-src.tar.gz`,
    "tar -xzf /tmp/solidtime-src.tar.gz -C /tmp",
    "SRC_DIR=$(find /tmp -maxdepth 1 -type d -name 'solidtime-*' | head -1)",
    'test -n "$SRC_DIR" && test -d "$SRC_DIR"',
    'cp -a "$SRC_DIR"/. /opt/solidtime/',
    "rm -rf /tmp/solidtime-src.tar.gz /tmp/solidtime-*",
    "",
    "cd /opt/solidtime",
    "cp .env.example .env",
    `VERSION=${qVersion}`,
    `APP_URL_OVERRIDE=${qAppUrl}`,
    `ENABLE_REG=${qReg}`,
    `MAIL_MAILER=${qMail}`,
    "LOCAL_IP=$(hostname -I | awk '{print $1}')",
    'if [ -n "$APP_URL_OVERRIDE" ]; then APP_URL="$APP_URL_OVERRIDE"; else APP_URL="http://${LOCAL_IP}"; fi',
    'sed -i "s|^APP_ENV=.*|APP_ENV=production|" .env',
    'sed -i "s|^APP_DEBUG=.*|APP_DEBUG=false|" .env',
    'sed -i "s|^APP_URL=.*|APP_URL=${APP_URL}|" .env',
    'sed -i "s|^APP_ENABLE_REGISTRATION=.*|APP_ENABLE_REGISTRATION=${ENABLE_REG}|" .env',
    'sed -i "s|^DB_CONNECTION=.*|DB_CONNECTION=pgsql|" .env',
    'sed -i "s|^DB_HOST=.*|DB_HOST=127.0.0.1|" .env',
    'sed -i "s|^DB_PORT=.*|DB_PORT=5432|" .env',
    'sed -i "s|^DB_DATABASE=.*|DB_DATABASE=solidtime|" .env',
    'sed -i "s|^DB_USERNAME=.*|DB_USERNAME=solidtime|" .env',
    'sed -i "s|^DB_PASSWORD=.*|DB_PASSWORD=${HDC_DB_PASS}|" .env',
    'sed -i "s|^FILESYSTEM_DISK=.*|FILESYSTEM_DISK=local|" .env',
    'sed -i "s|^PUBLIC_FILESYSTEM_DISK=.*|PUBLIC_FILESYSTEM_DISK=public|" .env',
    'sed -i "s|^MAIL_MAILER=.*|MAIL_MAILER=${MAIL_MAILER}|" .env',
    'sed -i "s|^SESSION_SECURE_COOKIE=.*|SESSION_SECURE_COOKIE=false|" .env',
    'grep -q "^SESSION_SECURE_COOKIE=" .env || echo "SESSION_SECURE_COOKIE=false" >> .env',
    'sed -i "s|^APP_FORCE_HTTPS=.*|APP_FORCE_HTTPS=false|" .env',
    'grep -q "^APP_FORCE_HTTPS=" .env || echo "APP_FORCE_HTTPS=false" >> .env',
    "",
    "php artisan self-host:generate-keys >/tmp/solidtime.keys 2>/dev/null || true",
    'if [ -s /tmp/solidtime.keys ]; then',
    "  while IFS= read -r line; do",
    '    KEY="${line%%=*}"',
    '    [ -z "$KEY" ] || [ "${KEY:0:1}" = "#" ] && continue',
    '    sed -i "/^${KEY}=/d" .env',
    '    echo "$line" >> .env',
    "  done < /tmp/solidtime.keys",
    "fi",
    "rm -f /tmp/solidtime.keys",
    "",
    "/usr/local/bin/composer install --no-dev --optimize-autoloader",
    "npm install",
    "npm run build",
    "php artisan migrate --force",
    "php artisan optimize:clear",
    "",
    "cat > /etc/caddy/Caddyfile <<'CADDYEOF'",
    ":80 {",
    "  root * /opt/solidtime/public",
    "  php_fastcgi unix//run/php/php8.3-fpm.sock",
    "  file_server",
    "  encode gzip",
    "}",
    "CADDYEOF",
    "usermod -aG www-data caddy 2>/dev/null || true",
    "chown -R www-data:www-data /opt/solidtime",
    "systemctl enable --now php8.3-fpm",
    "systemctl restart caddy",
    `echo "$VERSION" > /opt/solidtime/.hdc-installed-version`,
    "test -f /opt/solidtime/public/index.php",
  ].join("\n");
}

/**
 * @param {string} user
 * @param {string} pveHost
 * @param {number} vmid
 * @param {Record<string, unknown>} solidtime
 * @param {string} dbPassword
 */
export async function installSolidtimeInCt(user, pveHost, vmid, solidtime, dbPassword) {
  errout.write(`[hdc] solidtime install: unattended install in CT ${vmid} …\n`);

  const ready = await waitForCt(user, pveHost, vmid, 2000, "solidtime install");
  if (!ready) {
    return { ok: false, method: "unattended", message: `CT ${vmid} not reachable via pct exec` };
  }

  const inner = buildInstallScript(solidtime, dbPassword);
  const r = pctExec(user, pveHost, vmid, inner);
  if (r.status !== 0) {
    return {
      ok: false,
      method: "unattended",
      message: `install failed (exit ${r.status})`,
    };
  }
  const version = normalizeVersionTag(
    typeof solidtime.version === "string" ? solidtime.version : "v0.12.2",
  );
  errout.write(`[hdc] solidtime install: completed on CT ${vmid} (${version}).\n`);
  return { ok: true, method: "unattended", message: "installed", version };
}

/**
 * @param {string} user
 * @param {string} pveHost
 * @param {number} vmid
 */
export function readCtPrimaryIp(user, pveHost, vmid) {
  const r = pctExec(user, pveHost, vmid, "hostname -I | awk '{print $1}'", { capture: true });
  if (r.status !== 0) return null;
  const ip = r.stdout.trim().split(/\s+/)[0];
  return ip || null;
}

/**
 * @param {string} user
 * @param {string} pveHost
 * @param {number} vmid
 */
export function solidtimeInstalled(user, pveHost, vmid) {
  const r = pctExec(
    user,
    pveHost,
    vmid,
    "test -f /opt/solidtime/public/index.php && echo yes",
    { capture: true },
  );
  return r.status === 0 && r.stdout.trim() === "yes";
}

/**
 * @param {string} user
 * @param {string} pveHost
 * @param {number} vmid
 */
export function readInstalledVersion(user, pveHost, vmid) {
  const r = pctExec(
    user,
    pveHost,
    vmid,
    "cat /opt/solidtime/.hdc-installed-version 2>/dev/null || true",
    { capture: true },
  );
  if (r.status !== 0) return null;
  const v = r.stdout.trim();
  return v || null;
}

/**
 * @param {string} user
 * @param {string} pveHost
 * @param {number} vmid
 */
export function readAppUrlFromEnv(user, pveHost, vmid) {
  const r = pctExec(
    user,
    pveHost,
    vmid,
    "grep -E '^APP_URL=' /opt/solidtime/.env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\"'",
    { capture: true },
  );
  if (r.status !== 0) return null;
  const url = r.stdout.trim();
  return url || null;
}

/**
 * Fetch latest SolidTime release tag from GitHub.
 * @returns {Promise<string | null>}
 */
export async function fetchLatestReleaseTag() {
  const res = await fetch(GITHUB_RELEASES, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "hdc-solidtime" },
  });
  if (!res.ok) return null;
  const data = await res.json();
  const tag = typeof data.tag_name === "string" ? data.tag_name.trim() : "";
  return tag || null;
}
