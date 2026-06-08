/**
 * Curated daily maintenance recipe for `hdc maintain daily`.
 * Non-destructive: no prune, no rolling restarts, no reboots by default.
 */

/** @typedef {'client' | 'infrastructure' | 'service'} DailyTier */

/**
 * @typedef {object} DailyRecipeStep
 * @property {DailyTier} tier
 * @property {string} id
 * @property {'maintain' | 'query'} [verb]
 * @property {string[]} [args]
 * @property {boolean} [requiresConfig]
 * @property {string} [skipReason]
 * @property {string} [note]
 */

export const GUEST_BASELINE_SAFE_ARGS = ["--no-reboot", "--skip-resources", "--skip-clamav-scan"];

/** @type {readonly string[]} */
const DOCKER_COMPOSE_MAINTAIN_IDS = [
  "crowdsec",
  "draw-io",
  "homepage",
  "gatus",
  "gitlab",
  "immich",
  "keycloak",
  "listmonk",
  "mailcow",
  "n8n",
  "nextcloud",
  "open-webui",
  "greenbone",
  "hermes",
  "scanopy",
  "searxng",
  "solidtime",
  "uptime-kuma",
  "vaultwarden",
  "vikunja",
  "wallos",
  "wazuh",
  "yacy",
  "postiz",
  "asterisk",
  "wireguard",
  "postfix-relay",
];

/** @type {readonly string[]} */
const APT_UPGRADE_MAINTAIN_IDS = ["bind", "redis", "valkey"];

/** @type {readonly string[]} */
const PACKAGE_UPGRADE_MAINTAIN_IDS = ["postgresql", "splunk", "step-ca"];

/**
 * @param {string[]} base
 * @returns {DailyRecipeStep}
 */
function maintainService(id, base = []) {
  return {
    tier: "service",
    id,
    verb: "maintain",
    args: [...base, ...GUEST_BASELINE_SAFE_ARGS],
    requiresConfig: true,
  };
}

/**
 * @param {string} ref `tier/id` or `id` (service assumed)
 * @returns {{ tier: DailyTier; id: string } | null}
 */
export function parsePackageRef(ref) {
  const s = String(ref ?? "").trim();
  if (!s) return null;
  const slash = s.indexOf("/");
  if (slash >= 0) {
    const tier = s.slice(0, slash).trim().toLowerCase();
    const id = s.slice(slash + 1).trim();
    if (tier === "client" || tier === "infrastructure" || tier === "service") {
      return id ? { tier, id } : null;
    }
    return null;
  }
  return { tier: "service", id: s };
}

/**
 * @param {DailyTier} tier
 * @param {string} id
 * @returns {string}
 */
export function packageRefKey(tier, id) {
  return `${tier}/${id}`;
}

/**
 * @param {DailyRecipeStep} step
 * @param {{ skipUpgrades?: boolean }} [opts]
 * @returns {string[]}
 */
export function buildDailyStepArgs(step, opts = {}) {
  if (step.skipReason || !step.verb) return [];
  /** @type {string[]} */
  let args = [...(step.args ?? [])];
  if (!opts.skipUpgrades) return args;

  if (step.tier === "infrastructure" && step.id === "synology-nas" && step.verb === "maintain") {
    args.push("--skip-dsm-upgrade", "--skip-package-upgrade");
    return args;
  }
  if (step.tier === "service") {
    if (DOCKER_COMPOSE_MAINTAIN_IDS.includes(step.id) || step.id === "plex") {
      args.push("--skip-upgrade");
    }
    if (APT_UPGRADE_MAINTAIN_IDS.includes(step.id)) {
      args.push("--skip-apt");
    }
    if (PACKAGE_UPGRADE_MAINTAIN_IDS.includes(step.id) || step.id === "asterisk") {
      args.push("--skip-package-upgrade");
    }
  }
  return args;
}

/**
 * @returns {DailyRecipeStep[]}
 */
export function dailyRecipeSteps() {
  /** @type {DailyRecipeStep[]} */
  const steps = [];

  steps.push({
    tier: "infrastructure",
    id: "proxmox",
    verb: "maintain",
    args: [
      "--no-prune",
      "--no-download",
      "--no-build-qemu",
      "--skip-os-updates",
      "--skip-local-lvm",
    ],
    requiresConfig: true,
    note: "SSH keys, API token, load report, guest-agent ping, firewalls, backups, replication, HA",
  });

  steps.push({
    tier: "infrastructure",
    id: "synology-nas",
    verb: "query",
    args: [],
    requiresConfig: true,
    note: "Disk, RAID, Docker health",
  });
  steps.push({
    tier: "infrastructure",
    id: "synology-nas",
    verb: "maintain",
    args: [],
    requiresConfig: true,
    note: "DSM and package upgrades",
  });

  for (const id of ["cloudflare", "unifi-network", "azure", "gcp-oauth"]) {
    steps.push({
      tier: "infrastructure",
      id,
      verb: "query",
      args: [],
      requiresConfig: true,
      note: "Drift check (no apply)",
    });
  }

  steps.push({
    tier: "infrastructure",
    id: "ubuntu",
    skipReason: "bootstrap-only; not a daily task",
  });

  for (const id of ["windows", "client-ubuntu", "raspberrypi"]) {
    steps.push({
      tier: "client",
      id,
      verb: "query",
      args: [],
      requiresConfig: true,
      note: "Disk and pending update count",
    });
  }

  for (const id of DOCKER_COMPOSE_MAINTAIN_IDS) {
    steps.push(maintainService(id));
  }

  for (const id of PACKAGE_UPGRADE_MAINTAIN_IDS) {
    steps.push(maintainService(id));
  }

  for (const id of APT_UPGRADE_MAINTAIN_IDS) {
    steps.push(maintainService(id));
  }

  steps.push(maintainService("cassandra"));

  steps.push({
    tier: "service",
    id: "kafka",
    verb: "query",
    args: [],
    requiresConfig: true,
    note: "maintain always rolling-restarts brokers",
  });

  steps.push({
    tier: "service",
    id: "homeassistant",
    verb: "query",
    args: ["--live"],
    requiresConfig: true,
    note: "maintain can stop QEMU when USB mapped",
  });

  for (const id of ["nginx", "nginx-waf"]) {
    steps.push({
      tier: "service",
      id,
      verb: "query",
      args: [],
      requiresConfig: true,
      note: "Health and cert expiry; full maintain prunes sites",
    });
  }

  steps.push(maintainService("pi-hole", ["--skip-core-update"]));
  steps.push(maintainService("nagios"));
  steps.push(maintainService("ollama", ["--skip-models"]));
  steps.push(maintainService("lms", ["--skip-models"]));
  steps.push(maintainService("llama-cpp", ["--skip-restart"]));
  steps.push(maintainService("trivy"));
  steps.push({
    tier: "service",
    id: "plex",
    verb: "maintain",
    args: [],
    requiresConfig: true,
    note: "synopkg upgrade when behind",
  });

  for (const id of ["minecraft", "jenkins"]) {
    steps.push({
      tier: "service",
      id,
      skipReason: "stub maintain",
    });
  }

  return steps;
}

/**
 * @param {DailyRecipeStep[]} steps
 * @param {{ only?: Set<string>; skip?: Set<string>; skipClients?: boolean }} filters
 * @returns {DailyRecipeStep[]}
 */
export function filterDailyRecipeSteps(steps, filters = {}) {
  return steps.filter((step) => {
    const key = packageRefKey(step.tier, step.id);
    if (filters.skipClients && step.tier === "client") return false;
    if (filters.only?.size && !filters.only.has(key)) return false;
    if (filters.skip?.has(key)) return false;
    return true;
  });
}

/**
 * @param {string[]} argv
 * @returns {{
 *   dryRun: boolean;
 *   skipClients: boolean;
 *   skipUpgrades: boolean;
 *   noReport: boolean;
 *   reportPath?: string;
 *   only: Set<string>;
 *   skip: Set<string>;
 * }}
 */
export function parseDailyMaintainArgv(argv) {
  const dryRun = argv.includes("--dry-run");
  const skipClients = argv.includes("--skip-clients");
  const skipUpgrades = argv.includes("--skip-upgrades");
  const noReport = argv.includes("--no-report");
  /** @type {Set<string>} */
  const only = new Set();
  /** @type {Set<string>} */
  const skip = new Set();
  let reportPath;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--only" && argv[i + 1]) {
      const parsed = parsePackageRef(argv[++i]);
      if (parsed) only.add(packageRefKey(parsed.tier, parsed.id));
      continue;
    }
    if (a === "--skip" && argv[i + 1]) {
      const parsed = parsePackageRef(argv[++i]);
      if (parsed) skip.add(packageRefKey(parsed.tier, parsed.id));
      continue;
    }
    if (a === "--report" && argv[i + 1]) {
      reportPath = String(argv[++i]).trim();
      continue;
    }
  }

  return { dryRun, skipClients, skipUpgrades, noReport, reportPath, only, skip };
}
