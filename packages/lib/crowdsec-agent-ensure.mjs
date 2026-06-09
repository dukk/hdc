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
export function crowdsecAgentSkippedByFlags(flags) {
  return flagGet(flags ?? {}, "skip-crowdsec-agent", "skip_crowdsec_agent") !== undefined;
}

/** @returns {string} */
export function crowdsecAgentInstalledCheckCommand() {
  return "command -v crowdsec >/dev/null 2>&1 && test -f /etc/crowdsec/config.yaml";
}

/**
 * @param {string} lapiUrl
 * @param {string} enrollKey
 */
export function crowdsecAgentEnrollCommand(lapiUrl, enrollKey) {
  const url = lapiUrl.replace(/'/g, `'\\''`);
  const key = enrollKey.replace(/'/g, `'\\''`);
  return [
    "export DEBIAN_FRONTEND=noninteractive",
    "if ! command -v crowdsec >/dev/null 2>&1; then",
    "  curl -s https://packagecloud.io/install/repositories/crowdsec/crowdsec/script.deb.sh | bash",
    "  apt-get install -y -qq crowdsec",
    "fi",
    "mkdir -p /etc/crowdsec",
    `grep -q 'api.server' /etc/crowdsec/config.yaml 2>/dev/null || cscli config set api.server.enable_agent true || true`,
    `if ! cscli machines list -o raw 2>/dev/null | grep -q .; then`,
    `  cscli lapi register -u '${url}' -k '${key}' || cscli machines add "$(hostname)" --url '${url}' --password '${key}' || true`,
    "fi",
    "systemctl enable crowdsec 2>/dev/null || true",
    "systemctl restart crowdsec 2>/dev/null || true",
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
export async function ensureCrowdsecAgent(opts) {
  if (crowdsecAgentSkippedByFlags(opts.flags)) {
    opts.log.info(`${opts.exec.label}: CrowdSec agent skipped (--skip-crowdsec-agent)`);
    return { ok: true, skipped: true, message: "skipped by flag" };
  }

  const pxRoot = resolveProxmoxPackageRoot(opts.proxmoxPackageRoot, opts.repoRoot);
  const { crowdsec: block } = loadGuestAgentsConfig(pxRoot);
  if (!guestAgentBlockEnabled(block)) {
    return { ok: true, skipped: true, message: "guest_agents.crowdsec disabled or not configured" };
  }

  const lapiUrl = guestAgentStringField(block, "lapi_url");
  if (!lapiUrl) {
    return { ok: true, skipped: true, message: "guest_agents.crowdsec.lapi_url not set" };
  }

  const vaultKey = guestAgentVaultKey(block, "enroll_key_vault_key", "HDC_CROWDSEC_ENROLL_KEY");
  let enrollKey = "";
  if (opts.vaultAccess) {
    try {
      enrollKey = (await opts.vaultAccess.getSecret(vaultKey, { optional: true })) || "";
    } catch {
      enrollKey = "";
    }
  }
  if (!enrollKey) {
    return {
      ok: true,
      skipped: true,
      message: `enroll key missing (vault ${vaultKey})`,
    };
  }

  const already = opts.exec.run(crowdsecAgentInstalledCheckCommand(), { capture: true }).status === 0;

  try {
    if (!already) {
      const lock = await waitForAptLock(opts.exec, opts.log);
      if (!lock.ok) {
        return { ok: false, skipped: false, message: lock.message };
      }
    }
    opts.log.info(`${opts.exec.label}: ensuring CrowdSec agent → ${lapiUrl}`);
    const cmd = crowdsecAgentEnrollCommand(lapiUrl, enrollKey);
    const r = opts.exec.run(cmd, { capture: true });
    if (r.status !== 0) {
      const detail = `${r.stderr}${r.stdout}`.trim() || `exit ${r.status}`;
      throw new Error(detail);
    }
    return {
      ok: true,
      skipped: false,
      message: already ? "agent ensured" : "agent installed",
      lapi_url: lapiUrl,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (opts.log.warn) opts.log.warn(`${opts.exec.label}: CrowdSec agent failed: ${msg}`);
    return { ok: false, skipped: false, message: msg };
  }
}
