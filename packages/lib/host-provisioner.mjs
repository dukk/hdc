/**
 * Pluggable host provisioning for workloads (LXC on Proxmox, QEMU clones, Docker on Ubuntu, …).
 *
 * Implementations live under `packages/infrastructure/{proxmox,ubuntu}/lib/` and are imported by service deploy
 * scripts (for example the Ollama service deploy script).
 */

/**
 * @typedef {object} ProvisionLog
 * @property {(s: string) => void} info
 * @property {(s: string) => void} warn
 * @property {(s: string) => void} error
 */

/**
 * @typedef {object} ContainerCreateSpec
 * @property {string} name Display / hostname hint (no secrets).
 * @property {number} [memoryMb]
 * @property {number} [cores]
 * @property {number} [diskGb] Root disk or volume size where applicable.
 * @property {Record<string, string | number | boolean | undefined>} [parameters] Backend-specific (Proxmox API fields, Docker flags, …).
 */

/**
 * @typedef {object} VmCreateSpec
 * @property {string} name Guest name on the hypervisor.
 * @property {number} [memoryMb]
 * @property {number} [cores]
 * @property {number} [vmid] Target VM ID (Proxmox).
 * @property {number} [templateVmid] Source guest/template vmid for clone workflows.
 * @property {Record<string, string | number | boolean | undefined>} [parameters] Backend-specific.
 */

/**
 * @typedef {object} ProvisionResult
 * @property {boolean} ok
 * @property {string} [message] Human-readable outcome (stderr-safe; no secrets).
 * @property {Record<string, unknown>} [details] Structured payload for stdout JSON wrappers.
 */

/**
 * @typedef {object} HostProvisioner
 * @property {string} backendId Short id, e.g. `proxmox`, `ubuntu-docker`.
 * @property {(log: ProvisionLog, spec: ContainerCreateSpec) => Promise<ProvisionResult>} createContainer
 * @property {(log: ProvisionLog, spec: VmCreateSpec) => Promise<ProvisionResult>} createVm
 */

/**
 * @param {unknown} v
 * @returns {v is HostProvisioner}
 */
export function isHostProvisioner(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const o = /** @type {Record<string, unknown>} */ (v);
  return (
    typeof o.backendId === "string" &&
    typeof o.createContainer === "function" &&
    typeof o.createVm === "function"
  );
}

/**
 * @param {string} backendId
 * @returns {ProvisionResult}
 */
export function vmNotSupportedResult(backendId) {
  return {
    ok: false,
    message: `createVm is not supported for backend ${backendId} (use Proxmox for VMs).`,
  };
}

/**
 * @param {Console} con Prefer `console` with stderr methods for hdc deploy.
 * @returns {ProvisionLog}
 */
export function provisionLogFromConsole(con) {
  return {
    info: (s) => con.error(`[provision] ${s}`),
    warn: (s) => con.warn(`[provision] ${s}`),
    error: (s) => con.error(`[provision] ${s}`),
  };
}
