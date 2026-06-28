/**
 * Parse root `.env.example` into global vs per-package sections (by `# packages/...` headers).
 */

const PACKAGE_HEADER_RE = /packages\/((?:infrastructure|services|clients)\/[a-z0-9-]+)/i;
const ENV_KEY_RE = /^\s*(?:export\s+)?(HDC_[A-Z0-9_]+)\s*=/;
const ENV_KEY_MENTION_RE = /\b(HDC_[A-Z0-9_]+)\b/g;

/** @type {ReadonlySet<string>} */
export const GLOBAL_ENV_KEYS = new Set([
  "HDC_PRIVATE_ROOT",
  "HDC_VAULT_PASSPHRASE",
  "HDC_SECRET_BACKEND",
  "HDC_VAULTWARDEN_URL",
  "HDC_VAULTWARDEN_EMAIL",
  "HDC_VAULTWARDEN_ORGANIZATION_ID",
  "HDC_VAULTWARDEN_ORGANIZATION_NAME",
  "HDC_VAULTWARDEN_COLLECTION_ID",
  "HDC_VAULTWARDEN_MASTER_PASSWORD",
  "HDC_BW_EXECUTABLE",
  "HDC_TLS_INSECURE",
  "HDC_OPS_DISCORD_WEBHOOK_URL",
  "HDC_OPS_DISCORD_NOTIFY",
  "HDC_OPS_DISCORD_HOST",
  "HDC_CLI_INVOCATION",
  "HDC_ADMIN_USER",
  "HDC_GUEST_SSH_USER",
  "HDC_SKIP_LOCAL_SYSTEM_INVENTORY",
]);

/**
 * @typedef {{ packageRel: string | null; packageId: string | null; lines: string[] }} EnvExampleSection
 */

/**
 * @param {string} packageRel e.g. infrastructure/proxmox
 * @returns {string | null}
 */
export function packageIdFromRel(packageRel) {
  const parts = String(packageRel ?? "")
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean);
  if (parts.length < 2) return null;
  return parts[parts.length - 1] ?? null;
}

/**
 * @param {string} text Full `.env.example` contents
 * @returns {{ globalLines: string[]; sections: Map<string, string[]>; keyToPackageId: Map<string, string> }}
 */
export function parseEnvExampleSections(text) {
  /** @type {string[]} */
  const globalLines = [
    "# Copy to `.env` in the repo root (never commit `.env`).",
    "# Global HDC CLI settings (vault, secret backend, ops notifications, guest baseline).",
    "# Package-specific variables live under packages/<tier>/<id>/.env (see each package .env.example).",
    "",
  ];
  /** @type {Map<string, string[]>} */
  const sections = new Map();
  /** @type {Map<string, string>} */
  const keyToPackageId = new Map();

  /** @type {string | null} */
  let currentPackageRel = null;
  /** @type {string[]} */
  let currentLines = globalLines;

  for (const line of text.split(/\r?\n/)) {
    const headerMatch = line.match(PACKAGE_HEADER_RE);
    if (headerMatch) {
      const rel = headerMatch[1].replace(/\\/g, "/").replace(/\/+$/, "");
      const id = packageIdFromRel(rel);
      if (id) {
        currentPackageRel = rel;
        if (!sections.has(rel)) {
          sections.set(rel, [
            `# Copy to packages/${rel}/.env in hdc-private (or hdc root; never commit).`,
            `# Values are optional unless the package manifest declares env_required.`,
            "",
          ]);
        }
        currentLines = sections.get(rel);
        currentLines.push(line);
        continue;
      }
    }

    currentLines.push(line);

    const keyMatch = line.match(ENV_KEY_RE);
    if (keyMatch) {
      const key = keyMatch[1];
      if (GLOBAL_ENV_KEYS.has(key)) {
        if (currentPackageRel !== null) {
          currentLines.pop();
          globalLines.push(line);
        }
      } else if (currentPackageRel) {
        const id = packageIdFromRel(currentPackageRel);
        if (id) keyToPackageId.set(key, id);
      }
    } else {
      for (const m of line.matchAll(ENV_KEY_MENTION_RE)) {
        const key = m[1];
        if (!GLOBAL_ENV_KEYS.has(key) && currentPackageRel) {
          const id = packageIdFromRel(currentPackageRel);
          if (id && !keyToPackageId.has(key)) keyToPackageId.set(key, id);
        }
      }
    }
  }

  return { globalLines, sections, keyToPackageId };
}

/**
 * Assign orphan keys (proxmox block before first package header) to proxmox package.
 * @param {Map<string, string>} keyToPackageId
 */
export function applyOrphanKeyHeuristics(keyToPackageId) {
  for (const key of [...keyToPackageId.keys()]) {
    if (keyToPackageId.get(key)) continue;
  }
  const proxmoxPrefixes = ["HDC_PROXMOX_", "HDC_NAGIOS_SSH_USER", "HDC_HOMEPAGE_", "HDC_UNIFI_NETWORK_"];
  for (const [key, pkg] of keyToPackageId.entries()) {
    if (pkg === "proxmox") continue;
  }
  /** @type {[string, string][]} */
  const extra = [
    ["HDC_PROXMOX_SSH_USER", "proxmox"],
    ["HDC_PROXMOX_API_TOKEN", "proxmox"],
    ["HDC_PROXMOX_TLS_INSECURE", "proxmox"],
    ["HDC_PROXMOX_LXC_ROOT_PASSWORD", "proxmox"],
    ["HDC_NAGIOS_SSH_USER", "proxmox"],
    ["HDC_HOMEPAGE_HA_TOKEN", "proxmox"],
    ["HDC_HOMEPAGE_PLEX_TOKEN", "proxmox"],
    ["HDC_HOMEPAGE_AUDIOBOOKSHELF_TOKEN", "proxmox"],
    ["HDC_HOMEPAGE_CROWDSEC_LAPI_PASSWORD", "proxmox"],
    ["HDC_HOMEPAGE_PROXMOX_API_TOKEN", "proxmox"],
    ["HDC_PROXMOX_USER_HOMEPAGE_PASSWORD", "proxmox"],
    ["HDC_UNIFI_NETWORK_API_KEY", "unifi-network"],
    ["HDC_BIND_TSIG_KEY", "bind"],
    ["HDC_TWILIO_SIP_PASSWORD", "asterisk"],
    ["HDC_WINRM_USER_PASSWORD", "windows"],
    ["HDC_WINRM_USER", "windows"],
    ["HDC_CLIENT_SSH_USER", "windows"],
    ["HDC_PSEXEC_PATH", "windows"],
    ["HDC_OCI_TENANCY_OCID", "oci-compute"],
    ["HDC_OCI_USER_OCID", "oci-compute"],
    ["HDC_OCI_FINGERPRINT", "oci-compute"],
    ["HDC_OCI_REGION", "oci-compute"],
    ["HDC_OCI_API_PRIVATE_KEY", "oci-compute"],
  ];
  for (const [key, pkg] of extra) {
    if (!keyToPackageId.has(key)) keyToPackageId.set(key, pkg);
  }
  for (const key of keyToPackageId.keys()) {
    if (GLOBAL_ENV_KEYS.has(key)) keyToPackageId.delete(key);
  }
}
