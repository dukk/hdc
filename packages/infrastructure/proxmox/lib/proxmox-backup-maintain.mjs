import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { tryLoadPackageConfigFromPackageRoot } from "../../../../tools/hdc/lib/package-config.mjs";
import { repoRoot as defaultRepoRoot } from "../../../../tools/hdc/paths.mjs";
import {
  clusterConfigByKey,
  isProxmoxConfigObject,
  loadProxmoxHostsByCluster,
} from "./proxmox-config.mjs";
import {
  authorizeProxmoxForClusterMembers,
  proxmoxMaintainVerifyPaths,
} from "./proxmox-deploy-auth.mjs";
import {
  fetchClusterVmResources,
  locateVmidInCluster,
} from "./proxmox-host-provisioner.mjs";
import { loadProxmoxMaintainConfig } from "./proxmox-package-config.mjs";
import { lxcTemplateStorageFromConfig } from "./proxmox-provision-config.mjs";
import { fetchPveStorageList } from "./proxmox-storage-maintain.mjs";
import { pveFormBody, pveJsonRequest, pveDataArray } from "./pve-http.mjs";
import { notificationsMaintainEnabledFromConfig } from "./proxmox-notifications-maintain.mjs";

/** @typedef {{ schedule: string; prune_backups: string; mode: string; compress: string; storage?: string }} BackupProfileSpec */

export const DEFAULT_BACKUP_PROFILES = {
  weekly: {
    schedule: "sun 03:00",
    prune_backups: "keep-last=3",
    mode: "snapshot",
    compress: "zstd",
  },
  daily: {
    schedule: "daily",
    prune_backups: "keep-last=7",
    mode: "snapshot",
    compress: "zstd",
  },
  hourly: {
    schedule: "hourly",
    prune_backups: "keep-daily=7,keep-last=3",
    mode: "snapshot",
    compress: "zstd",
  },
};

const DEFAULT_JOB_ID_PREFIX = "hdc-backup";
const DEFAULT_DEFAULT_PROFILE = "weekly";
const DEFAULT_DEFAULT_STORAGE = "nas-a";

const BACKUP_COMPARE_KEYS = [
  "enabled",
  "storage",
  "schedule",
  "vmid",
  "mode",
  "compress",
  "prune-backups",
  "comment",
  "notification-mode",
];

/** @param {unknown} v */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * @param {unknown} cfg
 */
export function backupMaintainEnabledFromConfig(cfg) {
  if (!isProxmoxConfigObject(cfg)) return true;
  const provision = cfg.provision;
  if (!isObject(provision)) return true;
  const backups = provision.backups;
  if (!isObject(backups)) return true;
  return backups.enabled !== false && backups.enabled !== 0;
}

/**
 * @param {unknown} cfg
 */
export function backupManageFromDeployments(cfg) {
  if (!isProxmoxConfigObject(cfg)) return true;
  const provision = cfg.provision;
  if (!isObject(provision)) return true;
  const backups = provision.backups;
  if (!isObject(backups)) return true;
  return backups.manage_from_deployments !== false && backups.manage_from_deployments !== 0;
}

/**
 * @param {unknown} cfg
 * @returns {Record<string, BackupProfileSpec>}
 */
export function backupProfilesFromConfig(cfg) {
  /** @type {Record<string, BackupProfileSpec>} */
  const merged = { ...DEFAULT_BACKUP_PROFILES };
  if (!isProxmoxConfigObject(cfg)) return merged;
  const provision = cfg.provision;
  if (!isObject(provision)) return merged;
  const backups = provision.backups;
  if (!isObject(backups)) return merged;
  const profiles = backups.profiles;
  if (!isObject(profiles)) return merged;
  for (const [name, spec] of Object.entries(profiles)) {
    if (!isObject(spec)) continue;
    const base = merged[name] ?? DEFAULT_BACKUP_PROFILES.weekly;
    merged[name] = {
      schedule: typeof spec.schedule === "string" && spec.schedule.trim() ? spec.schedule.trim() : base.schedule,
      prune_backups:
        typeof spec.prune_backups === "string" && spec.prune_backups.trim()
          ? spec.prune_backups.trim()
          : base.prune_backups,
      mode: typeof spec.mode === "string" && spec.mode.trim() ? spec.mode.trim() : base.mode,
      compress: typeof spec.compress === "string" && spec.compress.trim() ? spec.compress.trim() : base.compress,
      storage: typeof spec.storage === "string" && spec.storage.trim() ? spec.storage.trim() : base.storage,
    };
  }
  return merged;
}

/**
 * @param {unknown} cfg
 */
export function backupDefaultStorageFromConfig(cfg) {
  if (!isProxmoxConfigObject(cfg)) return DEFAULT_DEFAULT_STORAGE;
  const provision = cfg.provision;
  if (!isObject(provision)) return DEFAULT_DEFAULT_STORAGE;
  const backups = provision.backups;
  if (!isObject(backups)) return DEFAULT_DEFAULT_STORAGE;
  const storage = backups.default_storage;
  return typeof storage === "string" && storage.trim() ? storage.trim() : DEFAULT_DEFAULT_STORAGE;
}

/**
 * @param {unknown} cfg
 */
export function backupDefaultProfileFromConfig(cfg) {
  if (!isProxmoxConfigObject(cfg)) return DEFAULT_DEFAULT_PROFILE;
  const provision = cfg.provision;
  if (!isObject(provision)) return DEFAULT_DEFAULT_PROFILE;
  const backups = provision.backups;
  if (!isObject(backups)) return DEFAULT_DEFAULT_PROFILE;
  const profile = backups.default_profile;
  return typeof profile === "string" && profile.trim() ? profile.trim() : DEFAULT_DEFAULT_PROFILE;
}

/**
 * @param {unknown} cfg
 */
export function backupJobIdPrefixFromConfig(cfg) {
  if (!isProxmoxConfigObject(cfg)) return DEFAULT_JOB_ID_PREFIX;
  const provision = cfg.provision;
  if (!isObject(provision)) return DEFAULT_JOB_ID_PREFIX;
  const backups = provision.backups;
  if (!isObject(backups)) return DEFAULT_JOB_ID_PREFIX;
  const prefix = backups.job_id_prefix;
  return typeof prefix === "string" && prefix.trim() ? prefix.trim() : DEFAULT_JOB_ID_PREFIX;
}

/**
 * @param {string} systemId
 * @param {string} [prefix]
 */
export function backupJobIdForSystem(systemId, prefix = DEFAULT_JOB_ID_PREFIX) {
  const slug = String(systemId ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${prefix}-${slug || "guest"}`;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function normalizePruneBackups(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value.trim();
  if (!isObject(value)) return String(value).trim();
  /** @type {string[]} */
  const parts = [];
  for (const [k, v] of Object.entries(value)) {
    if (v === undefined || v === null) continue;
    const key = String(k).trim();
    if (!key) continue;
    parts.push(`${key}=${String(v).trim()}`);
  }
  return parts.join(",");
}

/**
 * @param {unknown} a
 * @param {unknown} b
 */
function mergeBackupObjects(a, b) {
  const left = isObject(a) ? { ...a } : {};
  const right = isObject(b) ? { ...b } : {};
  return { ...left, ...right };
}

/**
 * @param {unknown} cfg
 * @param {unknown} serviceBackup
 * @returns {{ profile: string; schedule: string; storage: string; prune_backups: string; mode: string; compress: string }}
 */
export function resolveBackupSpec(cfg, serviceBackup) {
  const profiles = backupProfilesFromConfig(cfg);
  const defaultProfile = backupDefaultProfileFromConfig(cfg);
  const defaultStorage = backupDefaultStorageFromConfig(cfg);
  const merged = mergeBackupObjects({}, serviceBackup);
  const profileName =
    typeof merged.profile === "string" && merged.profile.trim() ? merged.profile.trim() : defaultProfile;
  const profile = profiles[profileName] ?? profiles[defaultProfile] ?? DEFAULT_BACKUP_PROFILES.weekly;
  return {
    profile: profileName,
    schedule:
      typeof merged.schedule === "string" && merged.schedule.trim() ? merged.schedule.trim() : profile.schedule,
    storage:
      typeof merged.storage === "string" && merged.storage.trim()
        ? merged.storage.trim()
        : profile.storage ?? defaultStorage,
    prune_backups:
      typeof merged.prune_backups === "string" && merged.prune_backups.trim()
        ? merged.prune_backups.trim()
        : profile.prune_backups,
    mode: typeof merged.mode === "string" && merged.mode.trim() ? merged.mode.trim() : profile.mode,
    compress: typeof merged.compress === "string" && merged.compress.trim() ? merged.compress.trim() : profile.compress,
  };
}

/**
 * @param {unknown} deployment
 * @param {unknown} defaultsBackup
 * @returns {{
 *   systemId: string;
 *   hostId: string;
 *   vmid: number | null;
 *   lookupName: string;
 *   serviceBackup: Record<string, unknown>;
 * } | null}
 */
export function deploymentBackupRow(deployment, defaultsBackup) {
  if (!isObject(deployment)) return null;
  const systemId = typeof deployment.system_id === "string" ? deployment.system_id.trim() : "";
  const px = isObject(deployment.proxmox) ? deployment.proxmox : null;
  if (!px) return null;
  const hostId = typeof px.host_id === "string" ? px.host_id.trim() : "";
  if (!hostId) return null;

  const mergedBackup = mergeBackupObjects(defaultsBackup, deployment.backup);
  if (mergedBackup.enabled === false || mergedBackup.enabled === 0) return null;

  const lxc = isObject(px.lxc) ? px.lxc : null;
  const qemu = isObject(px.qemu) ? px.qemu : null;
  /** @type {number | null} */
  let vmid = null;
  if (lxc && typeof lxc.vmid === "number" && lxc.vmid > 0) vmid = lxc.vmid;
  if (qemu && typeof qemu.vmid === "number" && qemu.vmid > 0) vmid = qemu.vmid;

  const lookupName =
    (typeof deployment.hostname === "string" && deployment.hostname.trim()) ||
    (lxc && typeof lxc.hostname === "string" && lxc.hostname.trim()) ||
    (qemu && typeof qemu.hostname === "string" && qemu.hostname.trim()) ||
    systemId;

  return {
    systemId: systemId || lookupName,
    hostId,
    vmid,
    lookupName,
    serviceBackup: mergedBackup,
  };
}

/**
 * @param {string} root
 * @param {unknown} cfg
 */
export function collectBackupTargetsFromPackages(root, cfg) {
  /** @type {Map<string, { systemId: string; hostId: string; vmid: number | null; lookupName: string; backup: ReturnType<typeof resolveBackupSpec> }>} */
  const bySystem = new Map();
  const servicesDir = join(root, "packages", "services");
  let entries = [];
  try {
    entries = readdirSync(servicesDir);
  } catch {
    return [];
  }
  for (const pkgId of entries) {
    const pkgRoot = join(servicesDir, pkgId);
    try {
      if (!statSync(pkgRoot).isDirectory()) continue;
    } catch {
      continue;
    }
    const exampleRel = `packages/services/${pkgId}/config.example.json`;
    const loaded = tryLoadPackageConfigFromPackageRoot(pkgRoot, { exampleRel });
    if (!loaded || !isObject(loaded.data)) continue;
    const defaultsBackup = isObject(loaded.data.defaults) ? loaded.data.defaults.backup : null;
    const deployments = loaded.data.deployments;
    if (!Array.isArray(deployments)) continue;
    for (const d of deployments) {
      const row = deploymentBackupRow(d, defaultsBackup);
      if (!row) continue;
      row.backup = resolveBackupSpec(cfg, mergeBackupObjects(defaultsBackup, isObject(d) ? d.backup : null));
      bySystem.set(row.systemId, {
        systemId: row.systemId,
        hostId: row.hostId,
        vmid: row.vmid,
        lookupName: row.lookupName,
        backup: row.backup,
      });
    }
  }
  return [...bySystem.values()];
}

/**
 * @param {Record<string, unknown>[]} resources
 * @param {string} name
 * @returns {{ vmid: number; node: string; name: string; template: boolean } | null}
 */
export function locateGuestByNameInCluster(resources, name) {
  const want = name.trim().toLowerCase();
  if (!want) return null;
  for (const r of resources) {
    if (typeof r.vmid !== "number") continue;
    const guestName = typeof r.name === "string" ? r.name.trim().toLowerCase() : "";
    if (guestName !== want) continue;
    const node = typeof r.node === "string" ? r.node.trim() : "";
    if (!node) continue;
    const template = r.template === 1 || r.template === true;
    return {
      vmid: r.vmid,
      node,
      name: typeof r.name === "string" ? r.name.trim() : `vmid-${r.vmid}`,
      template,
    };
  }
  return null;
}

/**
 * @param {object} target
 * @param {ReturnType<typeof resolveBackupSpec>} spec
 * @param {string} jobIdPrefix
 * @param {unknown} [cfg]
 */
export function buildBackupJobBody(target, spec, jobIdPrefix = DEFAULT_JOB_ID_PREFIX, cfg) {
  const id = backupJobIdForSystem(target.systemId, jobIdPrefix);
  /** @type {Record<string, string | number>} */
  const body = {
    id,
    enabled: 1,
    storage: spec.storage,
    schedule: spec.schedule,
    vmid: String(target.vmid),
    mode: spec.mode,
    compress: spec.compress,
    "prune-backups": spec.prune_backups,
    comment: `hdc-managed: ${target.systemId}`,
  };
  if (cfg && notificationsMaintainEnabledFromConfig(cfg)) {
    body["notification-mode"] = "notification-system";
  }
  return body;
}

/**
 * @param {Record<string, unknown>} desired
 * @param {Record<string, unknown>} live
 */
export function backupJobLegacyMailFields(live) {
  /** @type {string[]} */
  const deleteKeys = [];
  if (String(live.mailto ?? "").trim()) deleteKeys.push("mailto");
  if (live.mailnotification !== undefined && live.mailnotification !== null && String(live.mailnotification).trim()) {
    deleteKeys.push("mailnotification");
  }
  return deleteKeys;
}

/**
 * @param {Record<string, unknown>} desired
 * @param {Record<string, unknown>} live
 */
export function buildBackupJobPutForm(desired, live) {
  const deleteKeys = backupJobLegacyMailFields(live);
  const digest = typeof live.digest === "string" ? live.digest : undefined;
  return pveFormBody({
    ...desired,
    ...(deleteKeys.length ? { delete: deleteKeys } : {}),
    ...(digest ? { digest } : {}),
  });
}

/**
 * @param {Record<string, unknown>} desired
 * @param {Record<string, unknown>} live
 */
export function backupJobsMatch(desired, live) {
  for (const key of BACKUP_COMPARE_KEYS) {
    const dVal = desired[key];
    const lVal = live[key];
    if (key === "enabled") {
      const d = dVal === 1 || dVal === true || dVal === "1";
      const l = lVal === 1 || lVal === true || lVal === "1";
      if (d !== l) return false;
      continue;
    }
    if (key === "vmid") {
      if (String(dVal ?? "").trim() !== String(lVal ?? "").trim()) return false;
      continue;
    }
    if (key === "prune-backups") {
      if (normalizePruneBackups(dVal) !== normalizePruneBackups(lVal)) return false;
      continue;
    }
    if (key === "notification-mode") {
      const d = String(dVal ?? "").trim() || "auto";
      const l = String(lVal ?? "").trim() || "auto";
      if (d !== l) return false;
      continue;
    }
    if (String(dVal ?? "").trim() !== String(lVal ?? "").trim()) return false;
  }
  if (backupJobLegacyMailFields(live).length) return false;
  return true;
}

/**
 * @param {string} apiBase
 * @param {string} authorization
 * @param {boolean} rejectUnauthorized
 */
export async function fetchPveBackupJobs(apiBase, authorization, rejectUnauthorized) {
  const body = await pveJsonRequest(
    "GET",
    apiBase,
    "/cluster/backup",
    authorization,
    rejectUnauthorized,
    undefined,
  );
  return pveDataArray(body);
}

/**
 * @param {Record<string, unknown>[]} storageRows
 * @param {string} storageId
 */
export function storageSupportsBackup(storageRows, storageId) {
  const row = storageRows.find((r) => r.storage === storageId);
  if (!row) return { ok: false, reason: "storage not found" };
  const content = typeof row.content === "string" ? row.content : "";
  const types = content.split(",").map((s) => s.trim().toLowerCase());
  if (!types.includes("backup")) {
    return { ok: false, reason: "storage content missing backup" };
  }
  return { ok: true };
}

/**
 * @param {unknown} cfg
 * @returns {Map<string, string>}
 */
export function hostIdToClusterKeyFromConfig(cfg) {
  /** @type {Map<string, string>} */
  const map = new Map();
  if (!isProxmoxConfigObject(cfg)) return map;
  const byCluster = loadProxmoxHostsByCluster(cfg, {
    configPath: "",
    configRel: "packages/infrastructure/proxmox/config.json",
    onSkip: () => {},
  });
  for (const [clusterKey, members] of byCluster.entries()) {
    for (const m of members) {
      map.set(m.id, clusterKey);
    }
  }
  return map;
}

/**
 * @param {object} opts
 * @param {string} opts.packageRoot
 * @param {string} [opts.repoRoot]
 * @param {(line: string) => void} opts.log
 * @param {(line: string) => void} opts.warn
 * @param {boolean} opts.dryRun
 * @param {boolean} opts.prune
 * @param {import("../../../../tools/hdc/lib/vault-access.mjs").ReturnType<import("../../../../tools/hdc/lib/vault-access.mjs").createVaultAccess>} [opts.vault]
 */
export async function runProxmoxBackupMaintain(opts) {
  const { packageRoot, log, warn, dryRun, prune, vault } = opts;
  const root = opts.repoRoot || defaultRepoRoot();
  const loaded = loadProxmoxMaintainConfig(packageRoot, warn, "Backup maintain");
  if (!loaded) {
    return { ok: true, skipped: false, results: [] };
  }
  const cfg = loaded.data;

  if (!backupMaintainEnabledFromConfig(cfg)) {
    log("backup maintain: disabled in provision.backups.enabled — skip.");
    return { ok: true, skipped: false, results: [] };
  }

  if (!backupManageFromDeployments(cfg)) {
    log("backup maintain: manage_from_deployments false — skip.");
    return { ok: true, skipped: false, results: [] };
  }

  const jobIdPrefix = backupJobIdPrefixFromConfig(cfg);
  const hostCluster = hostIdToClusterKeyFromConfig(cfg);
  const targets = collectBackupTargetsFromPackages(root, cfg);

  if (!targets.length) {
    warn("backup maintain: no backup targets found in service package deployments — skip.");
    return { ok: true, skipped: false, results: [] };
  }

  log(
    `backup maintain: ${targets.length} target(s); prefix ${JSON.stringify(jobIdPrefix)}${dryRun ? " [dry-run]" : ""}${prune ? " [prune]" : ""}.`,
  );

  const configPath = join(packageRoot, "config.json");
  const configRel = "packages/infrastructure/proxmox/config.json";
  const byCluster = loadProxmoxHostsByCluster(cfg, {
    configPath,
    configRel,
    onSkip: (id, reason) => warn(`skip host ${JSON.stringify(id)} (${reason})`),
  });
  const clusterKeys = [...byCluster.keys()].sort();
  if (!clusterKeys.length) {
    warn(`backup maintain: no hypervisors in ${configRel}.`);
    return { ok: false, skipped: false, results: [] };
  }

  const lxcStorage = lxcTemplateStorageFromConfig(cfg);
  /** @type {Record<string, unknown>[]} */
  const results = [];
  let ok = true;

  /** @type {Set<string>} */
  const desiredJobIds = new Set();

  for (const clusterKey of clusterKeys) {
    const members = byCluster.get(clusterKey);
    if (!members?.length) continue;

    const clusterTargets = targets.filter((t) => hostCluster.get(t.hostId) === clusterKey);
    if (!clusterTargets.length) continue;

    const lead = members[0];
    log(`Cluster ${JSON.stringify(clusterKey)}: reconcile ${clusterTargets.length} backup job(s) …`);

    const configCluster = clusterConfigByKey(cfg, clusterKey);
    const auth = await authorizeProxmoxForClusterMembers({
      packageRoot,
      members,
      vault,
      warn,
      log,
      configCluster,
      verifyPaths: proxmoxMaintainVerifyPaths(lead.pveNode, lxcStorage),
    });
    if (!auth) {
      ok = false;
      warn(`Skipping cluster ${JSON.stringify(clusterKey)} — no API token.`);
      continue;
    }

    /** @type {Record<string, unknown>[]} */
    let resources = [];
    /** @type {Record<string, unknown>[]} */
    let storageRows = [];
    /** @type {Record<string, unknown>[]} */
    let liveJobs = [];
    try {
      [resources, storageRows, liveJobs] = await Promise.all([
        fetchClusterVmResources(auth.host.apiBase, auth.authorization, auth.rejectUnauthorized),
        fetchPveStorageList(auth.host.apiBase, auth.authorization, auth.rejectUnauthorized),
        fetchPveBackupJobs(auth.host.apiBase, auth.authorization, auth.rejectUnauthorized),
      ]);
    } catch (e) {
      ok = false;
      warn(`Cluster ${JSON.stringify(clusterKey)} API read failed: ${/** @type {Error} */ (e).message || e}`);
      continue;
    }

    const liveById = new Map(
      liveJobs
        .filter((j) => typeof j.id === "string")
        .map((j) => [String(j.id), j]),
    );

    for (const target of clusterTargets) {
      /** @type {Record<string, unknown>} */
      const row = {
        systemId: target.systemId,
        hostId: target.hostId,
        profile: target.backup.profile,
        clusterKey,
      };

      let vmid = target.vmid;
      if (vmid === null) {
        const located = locateGuestByNameInCluster(resources, target.lookupName);
        if (!located) {
          warn(`[${target.systemId}] guest ${JSON.stringify(target.lookupName)} not found in cluster — skip.`);
          row.ok = false;
          row.action = "skipped";
          row.error = "guest not found";
          results.push(row);
          continue;
        }
        if (located.template) {
          warn(`[${target.systemId}] ${JSON.stringify(target.lookupName)} is a template — skip.`);
          row.ok = false;
          row.action = "skipped";
          row.error = "template guest";
          results.push(row);
          continue;
        }
        vmid = located.vmid;
      } else {
        const located = locateVmidInCluster(resources, vmid);
        if (!located) {
          warn(`[${target.systemId}] vmid ${vmid} not found in cluster — skip.`);
          row.ok = false;
          row.action = "skipped";
          row.error = "vmid not found";
          results.push(row);
          continue;
        }
        if (located.template) {
          warn(`[${target.systemId}] vmid ${vmid} is a template — skip.`);
          row.ok = false;
          row.action = "skipped";
          row.error = "template guest";
          results.push(row);
          continue;
        }
      }

      row.vmid = vmid;
      const storageCheck = storageSupportsBackup(storageRows, target.backup.storage);
      if (!storageCheck.ok) {
        warn(
          `[${target.systemId}] storage ${JSON.stringify(target.backup.storage)}: ${storageCheck.reason} — job will still be ensured.`,
        );
        row.storageWarning = storageCheck.reason;
      }

      const resolvedTarget = { ...target, vmid };
      const desired = buildBackupJobBody(resolvedTarget, target.backup, jobIdPrefix, cfg);
      const jobId = String(desired.id);
      desiredJobIds.add(jobId);
      row.id = jobId;

      const live = liveById.get(jobId);
      if (live && backupJobsMatch(desired, live)) {
        log(`[${target.systemId}] backup job ${JSON.stringify(jobId)} OK.`);
        row.ok = true;
        row.action = "unchanged";
        results.push(row);
        continue;
      }

      if (live) {
        log(`[${target.systemId}] backup job ${JSON.stringify(jobId)} differs — will update${dryRun ? " [dry-run]" : ""}.`);
        row.action = "update";
      } else {
        log(`[${target.systemId}] backup job ${JSON.stringify(jobId)} missing — will create${dryRun ? " [dry-run]" : ""}.`);
        row.action = "create";
      }

      if (dryRun) {
        row.ok = true;
        results.push(row);
        continue;
      }

      try {
        const form = live ? buildBackupJobPutForm(desired, live) : pveFormBody(desired);
        if (live) {
          await pveJsonRequest(
            "PUT",
            auth.host.apiBase,
            `/cluster/backup/${encodeURIComponent(jobId)}`,
            auth.authorization,
            auth.rejectUnauthorized,
            form,
          );
        } else {
          await pveJsonRequest(
            "POST",
            auth.host.apiBase,
            "/cluster/backup",
            auth.authorization,
            auth.rejectUnauthorized,
            form,
          );
        }
        log(`[${target.systemId}] backup job ${JSON.stringify(jobId)} ${live ? "updated" : "created"}.`);
        row.ok = true;
      } catch (e) {
        ok = false;
        const err = /** @type {Error} */ (e).message || String(e);
        warn(`[${target.systemId}] backup job ${JSON.stringify(jobId)} failed: ${err}`);
        row.ok = false;
        row.error = err;
      }
      results.push(row);
    }

    if (prune) {
      for (const job of liveJobs) {
        const id = typeof job.id === "string" ? job.id.trim() : "";
        if (!id.startsWith(`${jobIdPrefix}-`)) continue;
        if (desiredJobIds.has(id)) continue;
        log(`backup job ${JSON.stringify(id)} stale — will delete${dryRun ? " [dry-run]" : ""}.`);
        /** @type {Record<string, unknown>} */
        const row = { id, action: "delete", clusterKey };
        if (dryRun) {
          row.ok = true;
          results.push(row);
          continue;
        }
        try {
          await pveJsonRequest(
            "DELETE",
            auth.host.apiBase,
            `/cluster/backup/${encodeURIComponent(id)}`,
            auth.authorization,
            auth.rejectUnauthorized,
            undefined,
          );
          log(`backup job ${JSON.stringify(id)} deleted.`);
          row.ok = true;
        } catch (e) {
          ok = false;
          const err = /** @type {Error} */ (e).message || String(e);
          warn(`backup job ${JSON.stringify(id)} delete failed: ${err}`);
          row.ok = false;
          row.error = err;
        }
        results.push(row);
      }
    }
  }

  return { ok, skipped: false, results };
}
