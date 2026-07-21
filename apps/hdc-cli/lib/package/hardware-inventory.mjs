/**
 * Shared physical-system hardware inventory helpers (sidecar write path + OEM shape).
 */
import {
  preferredNewFilePath,
  resolveRepoFile,
  writeResolvedRepoJson,
} from "../private-repo.mjs";
import { manualSidecarLegacyRels, manualSidecarRel } from "../inventory-paths.mjs";
import { loadManualSystemSidecar } from "./inventory-sidecar.mjs";

/** @param {unknown} v */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Resolve write target for operations/inventory/systems/<id>.json (prefer hdc-private for new).
 * Prefers an existing canonical sidecar; never writes to legacy inventory/manual paths.
 * @param {string} publicRoot
 * @param {string} systemId
 */
export function resolveSystemSidecarWrite(publicRoot, systemId) {
  const rel = manualSidecarRel("systems", systemId);
  const existing = resolveRepoFile(publicRoot, rel);
  if (existing.found) return existing;

  // If only a legacy path exists, still write to the canonical operations path.
  for (const legacyRel of manualSidecarLegacyRels("systems", systemId)) {
    const legacy = resolveRepoFile(publicRoot, legacyRel);
    if (legacy.found) {
      const path = preferredNewFilePath(publicRoot, rel);
      return {
        path,
        rel,
        found: false,
        source: path.includes("hdc-private") || path !== existing.publicPath ? "private" : "public",
        privateRoot: existing.privateRoot,
        publicPath: existing.publicPath,
      };
    }
  }

  const path = preferredNewFilePath(publicRoot, rel);
  return {
    path,
    rel,
    found: false,
    source: path.includes("hdc-private") || path !== existing.publicPath ? "private" : "public",
    privateRoot: existing.privateRoot,
    publicPath: existing.publicPath,
  };
}

/**
 * Build a hardware[] oem_windows entry from collector / OEM probe fields.
 * Never stores a full product key — only presence + optional PartialProductKey (last 5).
 * @param {object} opts
 * @param {boolean} [opts.firmwareMsdm]
 * @param {boolean} [opts.firmwareSlic]
 * @param {boolean} [opts.oa3KeyPresent]
 * @param {string | null} [opts.partialProductKey]
 * @param {string | null} [opts.channel]
 * @param {string | null} [opts.description]
 * @returns {Record<string, unknown> | null}
 */
export function oemWindowsHardwareEntry(opts = {}) {
  const firmwareMsdm = opts.firmwareMsdm === true;
  const firmwareSlic = opts.firmwareSlic === true;
  const oa3KeyPresent = opts.oa3KeyPresent === true;
  const partial =
    typeof opts.partialProductKey === "string" && opts.partialProductKey.trim()
      ? opts.partialProductKey.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(-5)
      : "";
  const channel = typeof opts.channel === "string" && opts.channel.trim() ? opts.channel.trim() : "";
  const description =
    typeof opts.description === "string" && opts.description.trim() ? opts.description.trim() : "";

  const present = firmwareMsdm || firmwareSlic || oa3KeyPresent || Boolean(partial);
  if (!present && !firmwareMsdm && !firmwareSlic && !oa3KeyPresent) {
    // Explicit negative: callers may still want to record absence.
    if (opts.firmwareMsdm === false || opts.firmwareSlic === false || opts.oa3KeyPresent === false) {
      return {
        type: "oem_windows",
        present: false,
        firmware_msdm: firmwareMsdm,
        firmware_slic: firmwareSlic,
        oa3_key_present: oa3KeyPresent,
      };
    }
    return null;
  }

  /** @type {Record<string, unknown>} */
  const entry = {
    type: "oem_windows",
    present,
    firmware_msdm: firmwareMsdm,
    firmware_slic: firmwareSlic,
    oa3_key_present: oa3KeyPresent,
  };
  if (partial) entry.partial_product_key = partial;
  if (channel) entry.channel = channel;
  if (description) entry.description = description;
  return entry;
}

/**
 * Merge or replace oem_windows entry inside a hardware[] array.
 * @param {Record<string, unknown>[]} hardware
 * @param {Record<string, unknown> | null} oemEntry
 */
export function mergeOemWindowsIntoHardware(hardware, oemEntry) {
  const list = Array.isArray(hardware) ? hardware.filter((h) => isObject(h) && h.type !== "oem_windows") : [];
  if (oemEntry && isObject(oemEntry)) list.push(oemEntry);
  return list;
}

/**
 * Map Proxmox node status (+ optional SSH collect) into inventory hardware[].
 * @param {object} opts
 * @param {unknown} [opts.statusBody] raw /nodes/{node}/status response or data object
 * @param {Record<string, unknown>[] | null} [opts.sshHardware] from parseHardwareOutput
 * @param {{ msdm?: boolean; slic?: boolean } | null} [opts.oemFirmware]
 * @returns {Record<string, unknown>[]}
 */
export function hardwareFromProxmoxNodeStatus(opts = {}) {
  const { statusBody, sshHardware = null, oemFirmware = null } = opts;

  if (Array.isArray(sshHardware) && sshHardware.length) {
    let hw = sshHardware.filter(isObject).map((h) => /** @type {Record<string, unknown>} */ ({ ...h }));
    if (oemFirmware && (oemFirmware.msdm === true || oemFirmware.slic === true || oemFirmware.msdm === false)) {
      const oem = oemWindowsHardwareEntry({
        firmwareMsdm: oemFirmware.msdm === true,
        firmwareSlic: oemFirmware.slic === true,
        oa3KeyPresent: false,
      });
      hw = mergeOemWindowsIntoHardware(hw, oem);
    }
    return hw;
  }

  /** @type {Record<string, unknown>[]} */
  const hardware = [];
  const raw = isObject(statusBody)
    ? statusBody.data && isObject(statusBody.data)
      ? statusBody.data
      : statusBody
    : null;
  if (!raw) {
    if (oemFirmware) {
      const oem = oemWindowsHardwareEntry({
        firmwareMsdm: oemFirmware.msdm === true,
        firmwareSlic: oemFirmware.slic === true,
      });
      if (oem) hardware.push(oem);
    }
    return hardware;
  }

  const cpuinfo = isObject(raw.cpuinfo) ? raw.cpuinfo : null;
  if (cpuinfo) {
    const model = typeof cpuinfo.modelname === "string" ? cpuinfo.modelname.trim() : "";
    let cores = Number(cpuinfo.cpus);
    if (!Number.isFinite(cores) || cores <= 0) {
      const c = Number(cpuinfo.cores);
      const s = Number(cpuinfo.sockets) || 1;
      cores = Number.isFinite(c) && c > 0 ? c * s : NaN;
    }
    if (model || Number.isFinite(cores)) {
      /** @type {Record<string, unknown>} */
      const cpu = { type: "cpu" };
      if (model) cpu.model = model;
      if (Number.isFinite(cores) && cores > 0) cpu.logical_cores = Math.round(cores);
      hardware.push(cpu);
    }
  }

  const memory = isObject(raw.memory) ? raw.memory : null;
  if (memory) {
    const total = Number(memory.total);
    if (Number.isFinite(total) && total > 0) {
      hardware.push({ type: "memory", total_gb: Math.round((total / 1e9) * 100) / 100 });
    }
  }

  if (oemFirmware) {
    const oem = oemWindowsHardwareEntry({
      firmwareMsdm: oemFirmware.msdm === true,
      firmwareSlic: oemFirmware.slic === true,
    });
    if (oem) hardware.push(oem);
  }

  return hardware;
}

/**
 * Upsert hardware[] (and optional access fields) onto a physical system sidecar.
 * @param {object} opts
 * @param {string} opts.publicRoot
 * @param {string} opts.systemId
 * @param {Record<string, unknown>[]} [opts.hardware]
 * @param {string} [opts.source] query_last.source
 * @param {Record<string, unknown>} [opts.accessNode] primary access node fields to merge
 * @param {string[]} [opts.tags]
 * @param {string[]} [opts.automationTargets]
 * @param {Record<string, unknown>} [opts.extraFields] merged onto sidecar root (e.g. notes skip)
 * @param {boolean} [opts.dryRun]
 * @param {(line: string) => void} [opts.log]
 * @returns {{ id: string; rel: string; created: boolean; path: string; sidecar: Record<string, unknown> }}
 */
export function upsertPhysicalSystemHardware(opts) {
  const {
    publicRoot,
    systemId,
    hardware = null,
    source = "hardware-import",
    accessNode = null,
    tags = [],
    automationTargets = [],
    extraFields = null,
    dryRun = false,
    log = () => {},
  } = opts;

  const id = String(systemId || "").trim();
  if (!id) throw new Error("systemId required");

  const collectedAt = new Date().toISOString();
  const existing = loadManualSystemSidecar(publicRoot, id);
  /** @type {Record<string, unknown>} */
  const next = existing && isObject(existing) ? structuredClone(existing) : {
    schema_version: 1,
    id,
    kind: "system",
    system_class: "physical",
  };

  next.schema_version = 1;
  next.id = id;
  next.kind = "system";
  if (typeof next.system_class !== "string" || !next.system_class) {
    next.system_class = "physical";
  }

  next.tags = unionStrings(next.tags, tags);
  next.automation_targets = unionStrings(next.automation_targets, automationTargets);
  next.last_verified = collectedAt;

  if (accessNode && isObject(accessNode)) {
    const access = isObject(next.access) ? /** @type {Record<string, unknown>} */ (next.access) : {};
    /** @type {Record<string, unknown>[]} */
    const nodes = Array.isArray(access.nodes)
      ? access.nodes.filter(isObject).map((n) => /** @type {Record<string, unknown>} */ ({ ...n }))
      : [];
    let primary = nodes[0];
    if (!primary) {
      primary = { name: "primary" };
      nodes.unshift(primary);
    }
    if (typeof primary.name !== "string" || !primary.name.trim()) primary.name = "primary";
    for (const [k, v] of Object.entries(accessNode)) {
      if (v === undefined || v === null || v === "") continue;
      primary[k] = v;
    }
    access.nodes = nodes;
    next.access = access;
  }

  if (Array.isArray(hardware) && hardware.length) {
    next.hardware = hardware;
  }

  if (extraFields && isObject(extraFields)) {
    for (const [k, v] of Object.entries(extraFields)) {
      if (k === "hardware" || k === "id" || k === "kind") continue;
      if (v === undefined) continue;
      next[k] = v;
    }
  }

  next.query_last = {
    ...(isObject(next.query_last) ? /** @type {Record<string, unknown>} */ (next.query_last) : {}),
    source,
    hardware_collected_at: collectedAt,
    collected_at: collectedAt,
  };

  const resolved = resolveSystemSidecarWrite(publicRoot, id);
  if (!dryRun) {
    writeResolvedRepoJson(resolved, next);
  }
  log(
    `${dryRun ? "dry-run: would write" : "wrote"} ${resolved.rel} ` +
      `(${existing ? "update" : "create"}${Array.isArray(hardware) && hardware.length ? ", hardware" : ""})`,
  );

  return {
    id,
    rel: resolved.rel,
    created: !existing,
    path: resolved.path,
    sidecar: next,
  };
}

/**
 * @param {unknown} a
 * @param {string[]} extra
 */
function unionStrings(a, extra) {
  /** @type {string[]} */
  const out = [];
  const seen = new Set();
  for (const list of [Array.isArray(a) ? a : [], extra]) {
    for (const x of list) {
      if (typeof x !== "string" || !x.trim()) continue;
      const t = x.trim();
      if (seen.has(t)) continue;
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}
