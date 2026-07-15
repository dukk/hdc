import { repoRoot as resolveRepoRoot } from "../../paths.mjs";
import { flagGet } from "./parse-argv-flags.mjs";
import { waitForAptLock } from "./apt-lock-wait.mjs";
import {
  guestAgentBlockEnabled,
  guestAgentStringField,
  guestAgentVaultKey,
  loadGuestAgentsConfig,
  resolveProxmoxPackageRoot,
} from "./guest-agents-config.mjs";
import { resolveWazuhManagerRelease } from "./wazuh-release.mjs";

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

/** @returns {string} */
export function wazuhAgentVersionQueryCommand() {
  return "dpkg-query -W -f='${Version}' wazuh-agent 2>/dev/null || true";
}

/**
 * @param {string} installedVersion e.g. 4.14.6-1
 * @param {string} wantedRelease e.g. 4.10.3
 */
export function wazuhAgentVersionMatches(installedVersion, wantedRelease) {
  const installed = String(installedVersion || "").trim();
  const wanted = String(wantedRelease || "").trim();
  if (!installed || !wanted) return true;
  return installed === wanted || installed.startsWith(`${wanted}-`);
}

/**
 * @param {string} managerHost
 * @param {string} registrationPassword
 * @param {string} [agentVersion] Manager release pin (e.g. 4.10.3)
 */
export function wazuhAgentInstallCommand(managerHost, registrationPassword, agentVersion = "") {
  const host = managerHost.replace(/'/g, `'\\''`);
  const pass = registrationPassword.replace(/'/g, `'\\''`);
  const version = agentVersion.trim();
  const versionPin =
    version && /^\d+\.\d+\.\d+$/.test(version)
      ? `wazuh-agent=${version}-*`
      : "wazuh-agent";
  const versionEnv = version ? `WAZUH_AGENT_VERSION='${version.replace(/'/g, `'\\''`)}'` : "";
  return [
    "export DEBIAN_FRONTEND=noninteractive",
    "if ! dpkg -s wazuh-agent >/dev/null 2>&1; then",
    "  rm -f /etc/apt/sources.list.d/wazuh.list",
    "  apt-get install -y -qq ca-certificates curl gnupg",
    "  install -d -m 0755 /etc/apt/keyrings",
    "  curl -fsSL https://packages.wazuh.com/key/GPG-KEY-WAZUH | gpg --dearmor -o /etc/apt/keyrings/wazuh.gpg",
    "  chmod 644 /etc/apt/keyrings/wazuh.gpg",
    '  echo "deb [signed-by=/etc/apt/keyrings/wazuh.gpg] https://packages.wazuh.com/4.x/apt/ stable main" > /etc/apt/sources.list.d/wazuh.list',
    "  apt-get update -qq",
    (versionEnv ? `${versionEnv} ` : "") +
      "WAZUH_MANAGER='" +
      host +
      "' WAZUH_REGISTRATION_PASSWORD='" +
      pass +
      "' apt-get install -y -qq " +
      versionPin,
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

  const root = opts.repoRoot || resolveRepoRoot();
  const pxRoot = resolveProxmoxPackageRoot(opts.proxmoxPackageRoot, root);
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
  const agentVersion = resolveWazuhManagerRelease(root);
  let wrongVersion = false;
  let installedVersion = "";
  if (already && agentVersion) {
    const ver = opts.exec.run(wazuhAgentVersionQueryCommand(), { capture: true });
    installedVersion = String(ver.stdout || "").trim();
    wrongVersion = !wazuhAgentVersionMatches(installedVersion, agentVersion);
  }

  try {
    if (!already || wrongVersion) {
      const lock = await waitForAptLock(opts.exec, opts.log);
      if (!lock.ok) {
        return { ok: false, skipped: false, message: lock.message };
      }
    }
    if (wrongVersion) {
      opts.log.info(
        `${opts.exec.label}: removing mismatched wazuh-agent ${installedVersion || "?"} (want ${agentVersion})`,
      );
      const purge = opts.exec.run(
        "export DEBIAN_FRONTEND=noninteractive; apt-get purge -y -qq wazuh-agent; rm -rf /var/ossec",
        { capture: true },
      );
      if (purge.status !== 0) {
        const detail = `${purge.stderr}${purge.stdout}`.trim() || `exit ${purge.status}`;
        throw new Error(detail);
      }
    }
    opts.log.info(
      `${opts.exec.label}: ensuring Wazuh agent → ${managerHost}${agentVersion ? ` (release ${agentVersion})` : ""}`,
    );
    const cmd = wazuhAgentInstallCommand(managerHost, regPass, agentVersion);
    const r = opts.exec.run(cmd, { capture: true });
    if (r.status !== 0) {
      const detail = `${r.stderr}${r.stdout}`.trim() || `exit ${r.status}`;
      throw new Error(detail);
    }
    return {
      ok: true,
      skipped: false,
      message: wrongVersion
        ? "agent reinstalled"
        : already
          ? "agent ensured"
          : "agent installed",
      manager_host: managerHost,
      ...(agentVersion ? { release: agentVersion } : {}),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (opts.log.warn) opts.log.warn(`${opts.exec.label}: Wazuh agent failed: ${msg}`);
    return { ok: false, skipped: false, message: msg };
  }
}
