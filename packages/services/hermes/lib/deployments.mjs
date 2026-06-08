import { deploymentSystemIdPattern, lxcSystemId } from "../../../../tools/hdc/lib/inventory-naming.mjs";
import { flagGet } from "../../../lib/parse-argv-flags.mjs";

const HERMES_ROLE = "hermes";

/** @param {unknown} v */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * @param {Record<string, unknown>} target
 * @param {Record<string, unknown>} source
 */
function deepMerge(target, source) {
  for (const [key, val] of Object.entries(source)) {
    if (isObject(val) && isObject(target[key])) {
      deepMerge(/** @type {Record<string, unknown>} */ (target[key]), val);
    } else {
      target[key] = val;
    }
  }
  return target;
}

/**
 * @param {Record<string, unknown>} defaults
 * @param {Record<string, unknown>} entry
 */
function mergeDeploymentEntry(defaults, entry) {
  const base = structuredClone(defaults);
  deepMerge(base, entry);
  const systemId =
    typeof entry.system_id === "string" && entry.system_id.trim()
      ? entry.system_id.trim()
      : typeof base.system_id === "string" && base.system_id.trim()
        ? base.system_id.trim()
        : "";
  if (systemId) base.system_id = systemId;
  return base;
}

/**
 * @param {Record<string, unknown>} cfg
 */
function normalizeV1(cfg) {
  const deploy = isObject(cfg.deploy) ? cfg.deploy : {};
  const mode = typeof deploy.mode === "string" ? deploy.mode.trim() : "";
  const systemId =
    typeof deploy.system_id === "string" && deploy.system_id.trim()
      ? deploy.system_id.trim()
      : lxcSystemId(HERMES_ROLE, "a");
  /** @type {Record<string, unknown>} */
  const defaults = { mode };
  if (isObject(cfg.proxmox)) defaults.proxmox = structuredClone(cfg.proxmox);
  if (isObject(cfg.hermes)) defaults.hermes = structuredClone(cfg.hermes);
  if (isObject(cfg.install)) defaults.install = structuredClone(cfg.install);
  return {
    schemaVersion: 1,
    defaults,
    deployments: [{ system_id: systemId }],
  };
}

/**
 * @param {Record<string, unknown>} cfg
 */
export function normalizeHermesConfig(cfg) {
  if (!isObject(cfg)) {
    throw new Error("hermes config must be a JSON object");
  }
  const version = typeof cfg.schema_version === "number" ? cfg.schema_version : 1;
  if (Array.isArray(cfg.deployments) && cfg.deployments.length > 0) {
    const defaults = isObject(cfg.defaults) ? structuredClone(cfg.defaults) : {};
    const raw = cfg.deployments.filter(isObject);
    if (!raw.length) {
      throw new Error("deployments[] is empty — add at least one entry");
    }
    const deployments = raw.map((entry) => mergeDeploymentEntry(defaults, entry));
    validateDeployments(deployments);
    return { schemaVersion: version >= 2 ? 2 : version, defaults, deployments };
  }
  if (isObject(cfg.deploy) || isObject(cfg.proxmox)) {
    const v1 = normalizeV1(cfg);
    const deployments = v1.deployments.map((entry) => mergeDeploymentEntry(v1.defaults, entry));
    validateDeployments(deployments);
    return { schemaVersion: 1, defaults: v1.defaults, deployments };
  }
  throw new Error("hermes config needs deployments[] or legacy deploy + proxmox blocks");
}

/**
 * @param {Record<string, unknown>[]} deployments
 */
function validateDeployments(deployments) {
  const ids = new Set();
  for (const d of deployments) {
    const sid = typeof d.system_id === "string" ? d.system_id.trim() : "";
    if (!sid) throw new Error("each deployment needs system_id");
    if (!deploymentSystemIdPattern(HERMES_ROLE).test(sid)) {
      throw new Error(`system_id ${JSON.stringify(sid)} must match hermes-<letter>`);
    }
    if (ids.has(sid)) throw new Error(`duplicate system_id ${JSON.stringify(sid)}`);
    ids.add(sid);
    const mode = typeof d.mode === "string" ? d.mode.trim() : "";
    if (mode === "proxmox-lxc" || mode === "" || !mode) {
      const px = isObject(d.proxmox) ? d.proxmox : {};
      const hostId = typeof px.host_id === "string" ? px.host_id.trim() : "";
      if (!hostId) {
        throw new Error(`${sid}: proxmox.host_id required for proxmox-lxc`);
      }
      const lxc = isObject(px.lxc) ? px.lxc : {};
      const vmid = typeof lxc.vmid === "number" ? lxc.vmid : Number(lxc.vmid);
      if (!Number.isFinite(vmid) || vmid <= 0) {
        throw new Error(`${sid}: proxmox.lxc.vmid must be a positive number`);
      }
    }
  }
}

/**
 * @param {Record<string, unknown>} cfg
 */
export function listHermesDeploymentSummaries(cfg) {
  const { deployments } = normalizeHermesConfig(cfg);
  return deployments.map((d) => {
    const mode = typeof d.mode === "string" ? d.mode : "proxmox-lxc";
    const px = isObject(d.proxmox) ? d.proxmox : {};
    const hostId = typeof px.host_id === "string" ? px.host_id : null;
    const lxc = isObject(px.lxc) ? px.lxc : {};
    const vmid = typeof lxc.vmid === "number" ? lxc.vmid : Number(lxc.vmid);
    const install = isObject(d.install) ? d.install : {};
    const hermes = isObject(d.hermes) ? d.hermes : {};
    return {
      system_id: d.system_id,
      mode,
      host_id: hostId,
      vmid: Number.isFinite(vmid) ? vmid : null,
      install_enabled: install.enabled !== false,
      image_tag: typeof hermes.image_tag === "string" ? hermes.image_tag : "latest",
      api_port: apiPort(hermes),
      dashboard_port: dashboardPort(hermes),
      dashboard_enabled: dashboardEnabled(hermes),
    };
  });
}

/**
 * @param {Record<string, unknown>} hermes
 */
export function apiPort(hermes) {
  const p = typeof hermes.api_port === "number" ? hermes.api_port : Number(hermes.api_port);
  if (Number.isFinite(p) && p >= 1 && p <= 65535) return Math.floor(p);
  return 8642;
}

/**
 * @param {Record<string, unknown>} hermes
 */
export function dashboardPort(hermes) {
  const p =
    typeof hermes.dashboard_port === "number" ? hermes.dashboard_port : Number(hermes.dashboard_port);
  if (Number.isFinite(p) && p >= 1 && p <= 65535) return Math.floor(p);
  return 9119;
}

/**
 * @param {Record<string, unknown>} hermes
 */
export function dashboardEnabled(hermes) {
  return hermes.dashboard_enabled !== false;
}

/**
 * @param {Record<string, unknown>} hermes
 */
export function dashboardUsername(hermes) {
  const u = typeof hermes.dashboard_username === "string" ? hermes.dashboard_username.trim() : "";
  return u || "admin";
}

/**
 * @param {Record<string, unknown>} hermes
 */
export function openrouterVaultKey(hermes) {
  const key =
    typeof hermes.openrouter_api_key_vault_key === "string" &&
    hermes.openrouter_api_key_vault_key.trim()
      ? hermes.openrouter_api_key_vault_key.trim()
      : "HDC_HERMES_OPENROUTER_API_KEY";
  return key;
}

/**
 * @param {Record<string, unknown>} hermes
 */
export function dashboardPasswordVaultKey(hermes) {
  const key =
    typeof hermes.dashboard_password_vault_key === "string" &&
    hermes.dashboard_password_vault_key.trim()
      ? hermes.dashboard_password_vault_key.trim()
      : "HDC_HERMES_DASHBOARD_PASSWORD";
  return key;
}

/**
 * @param {Record<string, unknown>} hermes
 */
export function dashboardAuthSecretVaultKey(hermes) {
  const key =
    typeof hermes.dashboard_auth_secret_vault_key === "string" &&
    hermes.dashboard_auth_secret_vault_key.trim()
      ? hermes.dashboard_auth_secret_vault_key.trim()
      : "HDC_HERMES_DASHBOARD_AUTH_SECRET";
  return key;
}

/**
 * @param {string | undefined} instance
 */
export function instanceFlagToSystemId(instance) {
  if (!instance) return undefined;
  const t = instance.trim();
  if (deploymentSystemIdPattern(HERMES_ROLE).test(t)) return t;
  return lxcSystemId(HERMES_ROLE, t);
}

/**
 * @param {Record<string, unknown>} d
 * @param {boolean} skipInstallCli
 * @param {boolean | undefined} skipInstallOpt
 */
function finalizeDeployment(d, skipInstallCli, skipInstallOpt) {
  const install = isObject(d.install) ? { ...d.install } : { enabled: true };
  if (skipInstallCli || skipInstallOpt === true) {
    install.enabled = false;
  }
  const mode = typeof d.mode === "string" && d.mode.trim() ? d.mode.trim() : "proxmox-lxc";
  return {
    systemId: String(d.system_id),
    mode,
    proxmox: isObject(d.proxmox) ? d.proxmox : null,
    hermes: isObject(d.hermes) ? d.hermes : {},
    install,
  };
}

/**
 * @param {Record<string, unknown>} cfg
 * @param {Record<string, string>} flags
 * @param {{ skipInstall?: boolean }} [opts]
 */
export function resolveHermesDeployments(cfg, flags, opts = {}) {
  const { deployments } = normalizeHermesConfig(cfg);
  const skipInstallCli = flags["skip-install"] !== undefined;

  let selectedId = flagGet(flags, "system-id", "system_id");
  const instance = flagGet(flags, "instance");
  if (!selectedId && instance) {
    selectedId = instanceFlagToSystemId(instance);
  }

  if (deployments.length === 1) {
    const d = deployments[0];
    if (selectedId && selectedId !== d.system_id) {
      throw new Error(
        `unknown system_id ${JSON.stringify(selectedId)} (only ${JSON.stringify(d.system_id)} configured)`,
      );
    }
    return [finalizeDeployment(d, skipInstallCli, opts.skipInstall)];
  }

  if (!selectedId) {
    return deployments.map((d) => finalizeDeployment(d, skipInstallCli, opts.skipInstall));
  }

  const d = deployments.find((x) => x.system_id === selectedId);
  if (!d) {
    throw new Error(`unknown system_id ${JSON.stringify(selectedId)}`);
  }
  return [finalizeDeployment(d, skipInstallCli, opts.skipInstall)];
}
