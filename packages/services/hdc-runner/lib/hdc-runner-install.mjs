import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { readCtPrimaryIp, resolvePveSshForHost } from "../../gatus/lib/gatus-install.mjs";

/**
 * Bitwarden CLI release URL (linux x86_64).
 *
 * @param {string} version
 */
export function bwDownloadUrl(version) {
  const v = String(version ?? "").trim() || "2025.11.0";
  return `https://github.com/bitwarden/clients/releases/download/cli-v${v}/bw-linux-${v}.zip`;
}

/**
 * @param {ReturnType<typeof import("./hdc-runner-settings.mjs").normalizeHdcRunnerBlock>} runner
 */
export function buildHdcRunnerInstallScript(runner) {
  const nodeMajor = String(runner.node_version ?? "22").replace(/^v/, "");
  const bwVersion = runner.bw_version ?? "2025.11.0";
  const meta = runner.meta_root ?? "/opt/hdc-runner";
  const installRoot = runner.install_root ?? "/opt/hdc";
  const privateRoot = runner.private_root ?? "/opt/hdc-private";

  return [
    "set -euo pipefail",
    "export DEBIAN_FRONTEND=noninteractive",
    "apt-get update -qq",
    "apt-get install -y -qq curl ca-certificates gnupg rsync git mailutils unzip openssh-server cron",
    "systemctl enable --now ssh 2>/dev/null || systemctl enable --now sshd 2>/dev/null || true",
    "systemctl enable --now cron 2>/dev/null || true",
    "",
    "# Node.js",
    "command -v node >/dev/null 2>&1 || {",
    "  curl -fsSL https://deb.nodesource.com/setup_" + nodeMajor + ".x | bash -",
    "  apt-get install -y -qq nodejs",
    "}",
    "",
    "# Bitwarden CLI (npm; zip fallback when npm registry unreachable)",
    "if ! command -v bw >/dev/null 2>&1; then",
    "  if npm install -g @bitwarden/cli@" + bwVersion + " 2>/dev/null; then",
    "    true",
    "  else",
    `    BW_URL='${bwDownloadUrl(bwVersion)}'`,
    "    TMP_BW=$(mktemp -d)",
    "    curl -fsSL \"$BW_URL\" -o \"$TMP_BW/bw.zip\"",
    "    unzip -qo \"$TMP_BW/bw.zip\" -d \"$TMP_BW\"",
    '    BW_BIN="$(find "$TMP_BW" -maxdepth 3 -type f -name bw 2>/dev/null | head -1)"',
    '    if [ -z "$BW_BIN" ] || [ ! -f "$BW_BIN" ]; then echo "bw binary not found in archive" >&2; exit 1; fi',
    '    install -m 0755 "$BW_BIN" /usr/local/bin/bw',
    "    rm -rf \"$TMP_BW\"",
    "  fi",
    "fi",
    "bw --version",
    "",
    "# Cursor CLI (agent) for scheduled subagent runs",
    "if ! command -v agent >/dev/null 2>&1; then",
    "  curl -fsSL https://cursor.com/install | bash || true",
    "fi",
    "export PATH=\"$HOME/.local/bin:/usr/local/bin:$PATH\"",
    "command -v agent >/dev/null 2>&1 && (agent --version 2>/dev/null || true)",
    "",
    `# Directory layout`,
    `mkdir -p '${installRoot}' '${privateRoot}' '${meta}/bin' '${meta}/logs' /var/log/hdc-runner`,
    "chown -R hdc:hdc /var/log/hdc-runner 2>/dev/null || true",
    "",
    "# Logrotate",
    "cat > /etc/logrotate.d/hdc-runner <<'LOGROTATE'",
    "/var/log/hdc-runner/*.log {",
    "  weekly",
    "  rotate 8",
    "  compress",
    "  missingok",
    "  notifempty",
    "  create 0640 hdc hdc",
    "}",
    "LOGROTATE",
    "",
    "node --version",
    "git --version",
    "rsync --version | head -1",
  ].join("\n");
}

/**
 * @param {import("../../postfix-relay/lib/postfix-relay-configure.mjs").ConfigureExec} exec
 * @param {ReturnType<typeof import("./hdc-runner-settings.mjs").normalizeHdcRunnerBlock>} runner
 * @param {{ info: (msg: string) => void }} log
 */
export function installHdcRunnerOnGuest(exec, runner, log) {
  log.info(`${exec.label}: installing Node.js, bw, and runner directories`);
  const script = buildHdcRunnerInstallScript(runner);
  const r = exec.run(script, { capture: true });
  if (r.status !== 0) {
    const detail = `${r.stderr}${r.stdout}`.trim() || `exit ${r.status}`;
    return { ok: false, message: detail };
  }
  return { ok: true, message: "install complete" };
}

/**
 * Install operator SSH public keys on guest hdc user.
 *
 * @param {import("../../postfix-relay/lib/postfix-relay-configure.mjs").ConfigureExec} exec
 * @param {{ info: (msg: string) => void; warn?: (msg: string) => void }} log
 */
export function ensureOperatorSshKeysOnGuest(exec, log) {
  const sshDir = join(homedir(), ".ssh");
  /** @type {string[]} */
  const keys = [];
  for (const name of ["id_ed25519.pub", "id_rsa.pub"]) {
    const p = join(sshDir, name);
    if (existsSync(p)) {
      keys.push(p);
    }
  }
  if (!keys.length) {
    log.warn?.(`${exec.label}: no operator SSH public keys found in ${sshDir}`);
    return { ok: true, skipped: true, message: "no operator keys" };
  }

  const pubKeys = keys.map((p) => readFileSync(p, "utf8").trim()).filter(Boolean);
  if (!pubKeys.length) {
    return { ok: false, message: "failed to read operator public keys" };
  }

  const script = [
    "set -e",
    "install -d -m 700 -o hdc -g hdc /home/hdc/.ssh",
    "touch /home/hdc/.ssh/authorized_keys",
    "chown hdc:hdc /home/hdc/.ssh/authorized_keys",
    "chmod 600 /home/hdc/.ssh/authorized_keys",
    ...pubKeys.map(
      (k) =>
        `grep -qxF '${k.replace(/'/g, `'\\''`)}' /home/hdc/.ssh/authorized_keys || echo '${k.replace(/'/g, `'\\''`)}' >> /home/hdc/.ssh/authorized_keys`,
    ),
  ].join("\n");

  log.info(`${exec.label}: installing operator SSH keys on hdc user`);
  const r = exec.run(script, { capture: true });
  if (r.status !== 0) {
    const detail = `${r.stderr}${r.stdout}`.trim() || `exit ${r.status}`;
    return { ok: false, message: detail };
  }
  return { ok: true, skipped: false, message: `${pubKeys.length} key(s)` };
}

/**
 * Install production npm deps in synced hdc tree (node_modules excluded from rsync).
 *
 * @param {import("../../postfix-relay/lib/postfix-relay-configure.mjs").ConfigureExec} exec
 * @param {string} installRoot
 * @param {{ info: (msg: string) => void }} log
 */
export function ensureHdcNpmDepsOnGuest(exec, installRoot, log) {
  const root = String(installRoot ?? "/opt/hdc").trim() || "/opt/hdc";
  log.info(`${exec.label}: npm install --omit=dev in ${root}`);
  const r = exec.run(
    `test -f '${root}/package.json' && cd '${root}' && npm install --omit=dev --no-audit --no-fund`,
    { capture: true },
  );
  if (r.status !== 0) {
    const detail = `${r.stderr}${r.stdout}`.trim() || `exit ${r.status}`;
    return { ok: false, message: detail };
  }
  return { ok: true, message: "npm deps installed" };
}

/**
 * Ensure cron is installed and running (idempotent on existing guests).
 *
 * @param {import("../../postfix-relay/lib/postfix-relay-configure.mjs").ConfigureExec} exec
 * @param {{ info: (msg: string) => void }} log
 */
export function ensureCronServiceOnGuest(exec, log) {
  log.info(`${exec.label}: ensuring cron package and service`);
  const script = [
    "set -e",
    "export DEBIAN_FRONTEND=noninteractive",
    "command -v cron >/dev/null 2>&1 || apt-get install -y -qq cron",
    "systemctl enable --now cron",
    "systemctl is-active cron",
  ].join("\n");
  const r = exec.run(script, { capture: true });
  if (r.status !== 0) {
    const detail = `${r.stderr}${r.stdout}`.trim() || `exit ${r.status}`;
    return { ok: false, message: detail };
  }
  return { ok: true, message: `${r.stdout}`.trim() || "active" };
}

export { resolvePveSshForHost, readCtPrimaryIp };
