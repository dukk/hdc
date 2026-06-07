import {
  deploymentSystemIdPattern,
  lxcSystemId,
  vmSystemId,
} from "../../../../tools/hdc/lib/inventory-naming.mjs";
import { flagGet } from "../../../lib/parse-argv-flags.mjs";
import { hdcRunnerSettingsForDeployment, normalizeHdcRunnerBlock } from "./hdc-runner-settings.mjs";

const RUNNER_ROLE = "hdc-runner";
const LXC_ID = deploymentSystemIdPattern(RUNNER_ROLE);
const QEMU_ID = /^vm-hdc-runner-[a-z]+$/;

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
export function normalizeHdcRunnerConfig(cfg) {
  if (!isObject(cfg)) {
    throw new Error("hdc-runner config must be a JSON object");
  }
  const version = typeof cfg.schema_version === "number" ? cfg.schema_version : 1;
  if (!Array.isArray(cfg.deployments) || cfg.deployments.length === 0) {
    throw new Error("hdc-runner config needs deployments[] with at least one entry");
  }
  const defaults = isObject(cfg.defaults) ? structuredClone(cfg.defaults) : {};
  const deployments = cfg.deployments.filter(isObject).map((entry) => mergeDeploymentEntry(defaults, entry));
  validateDeployments(deployments, defaults);
  return { schemaVersion: version >= 2 ? 2 : version, defaults, deployments };
}

/**
 * @param {Record<string, unknown>[]} deployments
 * @param {Record<string, unknown>} defaults
 */
function validateDeployments(deployments, defaults) {
  const ids = new Set();
  for (const d of deployments) {
    const sid = typeof d.system_id === "string" ? d.system_id.trim() : "";
    if (!sid) throw new Error("each deployment needs system_id");
    const mode =
      typeof d.mode === "string" && d.mode.trim() ? d.mode.trim() : "proxmox-lxc";

    if (mode === "proxmox-qemu") {
      if (!QEMU_ID.test(sid)) {
        throw new Error(`${sid}: proxmox-qemu requires vm-hdc-runner-<letter>`);
      }
    } else if (mode === "configure-only") {
      if (!LXC_ID.test(sid) && !QEMU_ID.test(sid)) {
        throw new Error(`${sid}: invalid system_id for configure-only`);
      }
    } else if (!LXC_ID.test(sid)) {
      throw new Error(`${sid}: proxmox-lxc requires hdc-runner-<letter>`);
    }

    if (ids.has(sid)) throw new Error(`duplicate system_id ${JSON.stringify(sid)}`);
    ids.add(sid);

    if (mode === "proxmox-lxc" || mode === "proxmox-qemu") {
      const px = isObject(d.proxmox) ? d.proxmox : {};
      const hostId = typeof px.host_id === "string" ? px.host_id.trim() : "";
      if (!hostId) throw new Error(`${sid}: proxmox.host_id required for ${mode}`);
    }

    const runner = hdcRunnerSettingsForDeployment(defaults, d);
    for (const sched of runner.schedules) {
      const id = typeof sched.id === "string" ? sched.id.trim() : "";
      if (!id) throw new Error(`${sid}: each schedule needs id`);
      const cron = typeof sched.cron === "string" ? sched.cron.trim() : "";
      if (!cron) throw new Error(`${sid}: schedule ${id} needs cron`);
      const cli = Array.isArray(sched.cli) ? sched.cli : [];
      if (!cli.length) throw new Error(`${sid}: schedule ${id} needs cli[]`);
    }
  }
}

/**
 * @param {Record<string, unknown>} cfg
 */
export function listHdcRunnerDeploymentSummaries(cfg) {
  const { defaults, deployments } = normalizeHdcRunnerConfig(cfg);
  return deployments.map((d) => {
    const mode = typeof d.mode === "string" && d.mode.trim() ? d.mode.trim() : "proxmox-lxc";
    const px = isObject(d.proxmox) ? d.proxmox : {};
    const hostId = typeof px.host_id === "string" ? px.host_id : null;
    const lxc = isObject(px.lxc) ? px.lxc : {};
    const qemu = isObject(px.qemu) ? px.qemu : {};
    const vmid =
      mode === "proxmox-qemu"
        ? typeof qemu.vmid === "number"
          ? qemu.vmid
          : Number(qemu.vmid)
        : typeof lxc.vmid === "number"
          ? lxc.vmid
          : Number(lxc.vmid);
    const runner = hdcRunnerSettingsForDeployment(defaults, d);
    return {
      system_id: d.system_id,
      mode,
      host_id: hostId,
      vmid: Number.isFinite(vmid) ? vmid : null,
      schedule_count: runner.schedules.length,
      install_root: runner.install_root,
      private_root: runner.private_root,
    };
  });
}

/**
 * @param {string | undefined} instance
 * @param {Record<string, unknown>[] | undefined} [deployments]
 */
export function instanceFlagToSystemId(instance, deployments) {
  if (!instance) return undefined;
  const t = instance.trim();
  if (LXC_ID.test(t) || QEMU_ID.test(t)) return t;
  if (Array.isArray(deployments)) {
    const qemu = deployments.find(
      (d) =>
        typeof d.system_id === "string" &&
        QEMU_ID.test(d.system_id) &&
        d.system_id.endsWith(`-${t}`),
    );
    if (qemu && typeof qemu.system_id === "string") return qemu.system_id;
  }
  return lxcSystemId(RUNNER_ROLE, t);
}

/**
 * @param {Record<string, unknown>} d
 * @param {Record<string, unknown>} defaults
 * @param {boolean} skipInstallCli
 */
function finalizeDeployment(d, defaults, skipInstallCli) {
  const install = isObject(d.install) ? { ...d.install } : { enabled: true };
  if (skipInstallCli) install.enabled = false;
  const mode = typeof d.mode === "string" && d.mode.trim() ? d.mode.trim() : "proxmox-lxc";
  return {
    systemId: String(d.system_id),
    mode,
    proxmox: isObject(d.proxmox) ? d.proxmox : null,
    configure: isObject(d.configure) ? d.configure : {},
    runner: hdcRunnerSettingsForDeployment(defaults, d),
    install,
    raw: d,
  };
}

/**
 * @param {Record<string, unknown>} cfg
 * @param {Record<string, string>} flags
 */
export function resolveHdcRunnerDeployments(cfg, flags) {
  const { defaults, deployments } = normalizeHdcRunnerConfig(cfg);
  const skipInstallCli = flags["skip-install"] !== undefined;

  let selectedId = flagGet(flags, "system-id", "system_id");
  const instance = flagGet(flags, "instance");
  if (!selectedId && instance) {
    selectedId = instanceFlagToSystemId(instance, deployments);
  }

  const mapOne = (d) => finalizeDeployment(d, defaults, skipInstallCli);

  if (deployments.length === 1) {
    const d = deployments[0];
    if (selectedId && selectedId !== d.system_id) {
      throw new Error(
        `unknown system_id ${JSON.stringify(selectedId)} (only ${JSON.stringify(d.system_id)} configured)`,
      );
    }
    return [mapOne(d)];
  }

  if (!selectedId) {
    return deployments.map(mapOne);
  }

  const d = deployments.find((x) => x.system_id === selectedId);
  if (!d) throw new Error(`unknown system_id ${JSON.stringify(selectedId)}`);
  return [mapOne(d)];
}

export { vmSystemId, lxcSystemId, RUNNER_ROLE };
