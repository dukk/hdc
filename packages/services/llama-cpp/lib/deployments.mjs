import { deploymentSystemIdPattern, lxcSystemId } from "../../../../tools/hdc/lib/inventory-naming.mjs";
import { flagGet } from "../../../lib/parse-argv-flags.mjs";

const LLAMA_CPP_ROLE = "llama-cpp";
/** Minimum LXC root disk (GB) for GGUF model storage. */
export const MIN_LLAMA_CPP_ROOTFS_GB = 128;

/** @type {readonly string[]} */
export const INSTALL_BACKENDS = ["cpu", "cuda", "vulkan", "rocm"];

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
      : lxcSystemId(LLAMA_CPP_ROLE, "a");
  /** @type {Record<string, unknown>} */
  const defaults = { mode };
  if (isObject(cfg.proxmox)) defaults.proxmox = structuredClone(cfg.proxmox);
  if (isObject(cfg.install)) defaults.install = structuredClone(cfg.install);
  if (isObject(cfg.server)) defaults.server = structuredClone(cfg.server);
  return {
    schemaVersion: 1,
    defaults,
    deployments: [{ system_id: systemId }],
  };
}

/**
 * @param {unknown} backend
 */
export function normalizeInstallBackend(backend) {
  const b = typeof backend === "string" ? backend.trim().toLowerCase() : "cpu";
  if (!INSTALL_BACKENDS.includes(b)) {
    throw new Error(
      `install.backend must be one of ${INSTALL_BACKENDS.join(", ")} (got ${JSON.stringify(backend)})`,
    );
  }
  return b;
}

/**
 * @param {Record<string, unknown>} cfg
 */
export function normalizeLlamaCppConfig(cfg) {
  if (!isObject(cfg)) {
    throw new Error("llama-cpp config must be a JSON object");
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
    const deployments = v1.deployments.map((entry) =>
      mergeDeploymentEntry(v1.defaults, entry),
    );
    validateDeployments(deployments);
    return { schemaVersion: 1, defaults: v1.defaults, deployments };
  }
  throw new Error("llama-cpp config needs deployments[] or legacy deploy + proxmox blocks");
}

/**
 * @param {Record<string, unknown>[]} deployments
 */
function validateDeployments(deployments) {
  const ids = new Set();
  for (const d of deployments) {
    const sid = typeof d.system_id === "string" ? d.system_id.trim() : "";
    if (!sid) throw new Error("each deployment needs system_id");
    if (!deploymentSystemIdPattern(LLAMA_CPP_ROLE).test(sid)) {
      throw new Error(`system_id ${JSON.stringify(sid)} must match llama-cpp-<letter>`);
    }
    if (ids.has(sid)) throw new Error(`duplicate system_id ${JSON.stringify(sid)}`);
    ids.add(sid);

    const install = isObject(d.install) ? d.install : {};
    normalizeInstallBackend(
      typeof install.backend === "string" ? install.backend : "cpu",
    );

    const mode = typeof d.mode === "string" ? d.mode.trim() : "";
    if (mode === "proxmox-lxc" || mode === "proxmox-qemu") {
      const px = isObject(d.proxmox) ? d.proxmox : {};
      const hostId = typeof px.host_id === "string" ? px.host_id.trim() : "";
      if (!hostId) {
        throw new Error(`${sid}: proxmox.host_id required for ${mode}`);
      }
      if (mode === "proxmox-lxc") {
        const lxc = isObject(px.lxc) ? px.lxc : {};
        const vmid = typeof lxc.vmid === "number" ? lxc.vmid : Number(lxc.vmid);
        if (!Number.isFinite(vmid) || vmid <= 0) {
          throw new Error(`${sid}: proxmox.lxc.vmid must be a positive number`);
        }
        const rootfsGb =
          typeof lxc.rootfs_gb === "number" ? lxc.rootfs_gb : Number(lxc.rootfs_gb);
        if (!Number.isFinite(rootfsGb) || rootfsGb <= 0) {
          throw new Error(`${sid}: proxmox.lxc.rootfs_gb must be a positive number`);
        }
        if (rootfsGb < MIN_LLAMA_CPP_ROOTFS_GB) {
          throw new Error(
            `${sid}: proxmox.lxc.rootfs_gb must be >= ${MIN_LLAMA_CPP_ROOTFS_GB} (got ${rootfsGb})`,
          );
        }
      }
    }
  }
}

/**
 * @param {Record<string, unknown>} cfg
 */
export function listLlamaCppDeploymentSummaries(cfg) {
  const { deployments } = normalizeLlamaCppConfig(cfg);
  return deployments.map((d) => {
    const mode = typeof d.mode === "string" ? d.mode : null;
    const px = isObject(d.proxmox) ? d.proxmox : {};
    const hostId = typeof px.host_id === "string" ? px.host_id : null;
    const lxc = isObject(px.lxc) ? px.lxc : {};
    const vmid = typeof lxc.vmid === "number" ? lxc.vmid : Number(lxc.vmid);
    const install = isObject(d.install) ? d.install : {};
    const server = isObject(d.server) ? d.server : {};
    return {
      system_id: d.system_id,
      mode,
      host_id: hostId,
      vmid: Number.isFinite(vmid) ? vmid : null,
      install_enabled: install.enabled !== false,
      install_backend: normalizeInstallBackend(
        typeof install.backend === "string" ? install.backend : "cpu",
      ),
      server_port: typeof server.port === "number" ? server.port : Number(server.port) || 8080,
      has_model:
        (typeof server.model === "string" && server.model.trim().length > 0) ||
        (typeof server.hf_model === "string" && server.hf_model.trim().length > 0),
    };
  });
}

/**
 * @param {string | undefined} instance
 */
export function instanceFlagToSystemId(instance) {
  if (!instance) return undefined;
  const t = instance.trim();
  if (deploymentSystemIdPattern(LLAMA_CPP_ROLE).test(t)) return t;
  return lxcSystemId(LLAMA_CPP_ROLE, t);
}

/**
 * @param {Record<string, unknown>} cfg
 * @param {Record<string, string>} flags
 * @param {{ skipInstall?: boolean }} [opts]
 */
export function resolveLlamaCppDeployments(cfg, flags, opts = {}) {
  const { deployments } = normalizeLlamaCppConfig(cfg);
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

/**
 * @param {Record<string, unknown>} cfg
 * @param {Record<string, string>} flags
 * @param {{ skipInstall?: boolean }} [opts]
 */
export function resolveLlamaCppDeployment(cfg, flags, opts = {}) {
  const list = resolveLlamaCppDeployments(cfg, flags, opts);
  return list[0];
}

/**
 * @param {Record<string, unknown>} d
 * @param {boolean} skipInstallCli
 * @param {boolean | undefined} skipInstallOpt
 */
function finalizeDeployment(d, skipInstallCli, skipInstallOpt) {
  const installRaw = isObject(d.install) ? { ...d.install } : { enabled: true, backend: "cpu" };
  const install = {
    ...installRaw,
    backend: normalizeInstallBackend(
      typeof installRaw.backend === "string" ? installRaw.backend : "cpu",
    ),
  };
  if (skipInstallCli || skipInstallOpt === true) {
    install.enabled = false;
  }
  const mode = typeof d.mode === "string" ? d.mode.trim() : "";
  const server = isObject(d.server) ? d.server : {};
  return {
    systemId: String(d.system_id),
    mode,
    proxmox: isObject(d.proxmox) ? d.proxmox : null,
    install,
    server,
  };
}
