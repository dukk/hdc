import { flagGet } from "./parse-argv-flags.mjs";
import { waitForAptLock } from "./apt-lock-wait.mjs";
import {
  guestAgentBlockEnabled,
  guestAgentCollectionsForServices,
  guestAgentStringField,
  guestAgentVaultKey,
  loadGuestAgentsConfig,
  resolveProxmoxPackageRoot,
} from "./guest-agents-config.mjs";
import { loadManualSystemSidecar } from "./inventory-sidecar.mjs";
import { buildCollectionsInstallScript } from "../services/crowdsec/lib/crowdsec-collections.mjs";

/**
 * @param {string[]} collections
 */
export function crowdsecAgentCollectionsCommand(collections) {
  if (!collections.length) return "";
  return buildCollectionsInstallScript(collections, { hubUpdate: true });
}

/**
 * Resolve service ids from inventory sidecar for collection extras.
 * @param {string} repoRoot
 * @param {string} [systemId]
 */
function serviceIdsForSystem(repoRoot, systemId) {
  if (!systemId) return [];
  const sidecar = loadManualSystemSidecar(repoRoot, systemId);
  if (!sidecar || !Array.isArray(sidecar.services)) return [];
  return sidecar.services
    .map((s) => (s && typeof s === "object" && typeof s.id === "string" ? s.id.trim() : ""))
    .filter(Boolean);
}

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
    "set -euo pipefail",
    "export DEBIAN_FRONTEND=noninteractive",
    "if ! command -v crowdsec >/dev/null 2>&1; then",
    "  curl -s https://packagecloud.io/install/repositories/crowdsec/crowdsec/script.deb.sh | bash",
    "  apt-get install -y -qq crowdsec",
    "fi",
    "mkdir -p /etc/crowdsec",
    // Prefer in-place yaml edit over cscli config set (colons in values).
    "python3 - <<'PY' || true",
    "import pathlib",
    "try:",
    "  import yaml",
    "except ImportError:",
    "  raise SystemExit(0)",
    "path = pathlib.Path('/etc/crowdsec/config.yaml')",
    "cfg = yaml.safe_load(path.read_text(encoding='utf-8')) or {}",
    "server = cfg.setdefault('api', {}).setdefault('server', {})",
    "server['enable'] = False",
    "path.write_text(yaml.safe_dump(cfg, default_flow_style=False, sort_keys=False), encoding='utf-8')",
    "PY",
    "CREDS=/etc/crowdsec/local_api_credentials.yaml",
    `LAPI_URL='${url}'`,
    `TOKEN='${key}'`,
    "NEED_REGISTER=1",
    'if [ -f "$CREDS" ] && grep -q "login:" "$CREDS" 2>/dev/null; then',
    "  CUR_URL=$(awk '/^url:/{print $2; exit}' \"$CREDS\" | tr -d '\\r')",
    '  if [ "$CUR_URL" = "$LAPI_URL" ]; then NEED_REGISTER=0; fi',
    "fi",
    'if [ "$NEED_REGISTER" = "1" ]; then',
    '  printf \"url: %s\\nlogin: pending\\npassword: pending\\n\" \"$LAPI_URL\" > \"$CREDS\"',
    '  cscli lapi register -u "$LAPI_URL" --token "$TOKEN" --machine "$(hostname -s)" -f "$CREDS"',
    "fi",
    "test -f \"$CREDS\"",
    "grep -q \"login:\" \"$CREDS\"",
    'grep -qv "login: pending" "$CREDS"',
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
 * @param {string} [opts.systemId]
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

    const effectiveRepoRoot = opts.repoRoot ?? "";
    const serviceIds = serviceIdsForSystem(effectiveRepoRoot, opts.systemId);
    const collections = guestAgentCollectionsForServices(block, serviceIds);
    const collCmd = crowdsecAgentCollectionsCommand(collections);
    if (collCmd) {
      opts.log.info(`${opts.exec.label}: installing CrowdSec collections (${collections.length})`);
      const collRes = opts.exec.run(collCmd, { capture: true });
      if (collRes.status !== 0) {
        const detail = `${collRes.stderr}${collRes.stdout}`.trim() || `exit ${collRes.status}`;
        throw new Error(`collections install failed: ${detail}`);
      }
    }

    return {
      ok: true,
      skipped: false,
      message: already ? "agent ensured" : "agent installed",
      lapi_url: lapiUrl,
      collections,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (opts.log.warn) opts.log.warn(`${opts.exec.label}: CrowdSec agent failed: ${msg}`);
    return { ok: false, skipped: false, message: msg };
  }
}
