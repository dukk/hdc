import { flagGet } from "./parse-argv-flags.mjs";
import { waitForAptLock } from "./apt-lock-wait.mjs";
import {
  guestAgentBlockEnabled,
  guestAgentStringField,
  guestAgentVaultKey,
  loadGuestAgentsConfig,
  resolveProxmoxPackageRoot,
} from "./guest-agents-config.mjs";

/**
 * @param {Record<string, string>} [flags]
 */
export function wazuhAgentSkippedByFlags(flags) {
  return flagGet(flags ?? {}, "skip-wazuh-agent", "skip_wazuh_agent") !== undefined;
}

/** @returns {string} */
export function wazuhAgentInstalledCheckCommand() {
  return "dpkg -s wazuh-agent >/dev/null 2>&1";
}

/**
 * @param {string} managerHost
 * @param {string} registrationPassword
 */
export function wazuhAgentInstallCommand(managerHost, registrationPassword) {
  const host = managerHost.replace(/'/g, `'\\''`);
  const pass = registrationPassword.replace(/'/g, `'\\''`);
  return [
    "export DEBIAN_FRONTEND=noninteractive",
    "if ! dpkg -s wazuh-agent >/dev/null 2>&1; then",
    "  curl -s https://packages.wazuh.com/key/GPG-KEY-WAZUH | gpg --no-default-keyring --keyring gnupg-ring:/usr/share/keyrings/wazuh.gpg --import 2>/dev/null || true",
    "  chmod 644 /usr/share/keyrings/wazuh.gpg 2>/dev/null || true",
    '  echo "deb [signed-by=/usr/share/keyrings/wazuh.gpg] https://packages.wazuh.com/4.x/apt/ stable main" > /etc/apt/sources.list.d/wazuh.list',
    "  apt-get update -qq",
    "  WAZUH_MANAGER='" + host + "' WAZUH_REGISTRATION_PASSWORD='" + pass + "' apt-get install -y -qq wazuh-agent",
    "else",
    "  if [ -f /var/ossec/etc/ossec.conf ]; then",
    "    sed -i 's|<address>.*</address>|<address>" + host + "</address>|' /var/ossec/etc/ossec.conf 2>/dev/null || true",
    "  fi",
    "fi",
    "systemctl daemon-reload 2>/dev/null || true",
    "systemctl enable wazuh-agent 2>/dev/null || true",
    "systemctl restart wazuh-agent 2>/dev/null || true",
  ].join("\n");
}

/**
 * @param {object} opts
 * @param {import("./clamav-ensure.mjs").ConfigureExec} opts.exec
 * @param {{ info: (msg: string) => void; warn?: (msg: string) => void }} opts.log
 * @param {Record<string, string>} [opts.flags]
 * @param {ReturnType<import("./package-vault-access.mjs").createPackageVaultAccess>} [opts.vaultAccess]
 * @param {string} [opts.proxmoxPackageRoot]
 * @param {string} [opts.repoRoot]
 */
export async function ensureWazuhAgent(opts) {
  if (wazuhAgentSkippedByFlags(opts.flags)) {
    opts.log.info(`${opts.exec.label}: Wazuh agent skipped (--skip-wazuh-agent)`);
    return { ok: true, skipped: true, message: "skipped by flag" };
  }

  const pxRoot = resolveProxmoxPackageRoot(opts.proxmoxPackageRoot, opts.repoRoot);
  const { wazuh: block } = loadGuestAgentsConfig(pxRoot);
  if (!guestAgentBlockEnabled(block)) {
    return { ok: true, skipped: true, message: "guest_agents.wazuh disabled or not configured" };
  }

  const managerHost = guestAgentStringField(block, "manager_host");
  if (!managerHost) {
    return { ok: true, skipped: true, message: "guest_agents.wazuh.manager_host not set" };
  }

  const vaultKey = guestAgentVaultKey(
    block,
    "registration_password_vault_key",
    "HDC_WAZUH_AGENT_PASSWORD",
  );
  let regPass = "";
  if (opts.vaultAccess) {
    try {
      regPass = (await opts.vaultAccess.getSecret(vaultKey, { optional: true })) || "";
    } catch {
      regPass = "";
    }
  }
  if (!regPass) {
    return {
      ok: true,
      skipped: true,
      message: `registration password missing (vault ${vaultKey})`,
    };
  }

  const already = opts.exec.run(wazuhAgentInstalledCheckCommand(), { capture: true }).status === 0;

  try {
    if (!already) {
      const lock = await waitForAptLock(opts.exec, opts.log);
      if (!lock.ok) {
        return { ok: false, skipped: false, message: lock.message };
      }
    }
    opts.log.info(`${opts.exec.label}: ensuring Wazuh agent → ${managerHost}`);
    const cmd = wazuhAgentInstallCommand(managerHost, regPass);
    const r = opts.exec.run(cmd, { capture: true });
    if (r.status !== 0) {
      const detail = `${r.stderr}${r.stdout}`.trim() || `exit ${r.status}`;
      throw new Error(detail);
    }
    return {
      ok: true,
      skipped: false,
      message: already ? "agent ensured" : "agent installed",
      manager_host: managerHost,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (opts.log.warn) opts.log.warn(`${opts.exec.label}: Wazuh agent failed: ${msg}`);
    return { ok: false, skipped: false, message: msg };
  }
}
