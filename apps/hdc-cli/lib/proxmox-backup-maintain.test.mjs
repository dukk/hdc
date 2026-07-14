import { describe, expect, it } from "vitest";
import {
  applyStaggeredSchedulesToTargets,
  BACKUP_DOW,
  backupJobIdForSystem,
  backupJobIdPrefixFromConfig,
  backupJobLegacyMailFields,
  backupJobsMatch,
  backupProfilesFromConfig,
  buildBackupJobBody,
  buildBackupJobPutForm,
  collectBackupTargetsFromPackages,
  collectClusterOrphanBackupTargets,
  collectDeploymentsFromPackageData,
  computeStaggeredBackupSchedule,
  deploymentBackupRow,
  formatNightTime,
  hashStringToUint,
  normalizePruneBackups,
  parseBackupScheduleParts,
  resolveBackupSpec,
  storageSupportsBackup,
  weekdayGapDays,
} from "../../../clumps/infrastructure/proxmox/lib/proxmox-backup-maintain.mjs";
import {
  BACKUP_FREQUENCY_TAGS,
  backupFrequencyTagForProfile,
  mergeBackupFrequencyTag,
  parseProxmoxTags,
} from "../../../clumps/infrastructure/proxmox/lib/proxmox-guest-tags.mjs";

const proxmoxCfg = {
  provision: {
    backups: {
      default_storage: "nas-1",
      default_profile: "weekly",
      profiles: {
        weekly: { schedule: "sun 03:00", prune_backups: "keep-last=3", mode: "snapshot", compress: "zstd" },
        daily: { schedule: "03:00", prune_backups: "keep-last=3", mode: "snapshot", compress: "zstd" },
        hourly: { schedule: "hourly", prune_backups: "keep-last=3,keep-daily=7", mode: "snapshot", compress: "zstd" },
        "twice-weekly": {
          schedule: "mon,thu 03:00",
          prune_backups: "keep-last=3",
          mode: "snapshot",
          compress: "zstd",
        },
      },
    },
    notifications: {
      enabled: true,
      mailto: "ops@example.invalid",
    },
  },
};

describe("proxmox backup maintain", () => {
  it("backupJobIdForSystem builds stable ids", () => {
    expect(backupJobIdForSystem("vaultwarden-a")).toBe("hdc-backup-vaultwarden-a");
    expect(backupJobIdForSystem("vm-bind-a", "hdc-backup")).toBe("hdc-backup-vm-bind-a");
  });

  it("backupJobIdPrefixFromConfig reads prefix", () => {
    expect(backupJobIdPrefixFromConfig({ provision: { backups: { job_id_prefix: "hdc-bu" } } })).toBe("hdc-bu");
    expect(backupJobIdPrefixFromConfig({})).toBe("hdc-backup");
  });

  it("normalizePruneBackups accepts string or object", () => {
    expect(normalizePruneBackups("keep-last=3")).toBe("keep-last=3");
    expect(normalizePruneBackups({ "keep-last": "3", "keep-daily": "7" })).toBe("keep-last=3,keep-daily=7");
  });

  it("resolveBackupSpec merges profile and overrides", () => {
    const spec = resolveBackupSpec(proxmoxCfg, { profile: "hourly" });
    expect(spec.profile).toBe("hourly");
    expect(spec.schedule).toBe("hourly");
    expect(spec.storage).toBe("nas-1");
    expect(spec.prune_backups).toBe("keep-last=3,keep-daily=7");
    expect(spec.frequency_tag).toBe("backup-hourly");

    const custom = resolveBackupSpec(proxmoxCfg, { schedule: "daily", prune_backups: "keep-last=5" });
    expect(custom.schedule).toBe("daily");
    expect(custom.prune_backups).toBe("keep-last=5");
    expect(custom.profile).toBe("weekly");
  });

  it("backupProfilesFromConfig merges defaults with config", () => {
    const profiles = backupProfilesFromConfig(proxmoxCfg);
    expect(profiles.weekly.prune_backups).toBe("keep-last=3");
    expect(profiles.daily.prune_backups).toBe("keep-last=3");
    expect(profiles["twice-weekly"].prune_backups).toBe("keep-last=3");
    expect(profiles.hourly.prune_backups).toBe("keep-last=3,keep-daily=7");
  });

  it("computeStaggeredBackupSchedule stays in midnight–6am window", () => {
    for (const id of ["vm-bind-a", "vaultwarden-a", "pi-hole-b", "affine-a"]) {
      const daily = computeStaggeredBackupSchedule({ profile: "daily", systemId: id });
      expect(daily).toMatch(/^\d{2}:\d{2}$/);
      const [hh, mm] = daily.split(":").map(Number);
      expect(hh * 60 + mm).toBeLessThan(360);

      const weekly = computeStaggeredBackupSchedule({ profile: "weekly", systemId: id });
      expect(weekly).toMatch(/^(mon|tue|wed|thu|fri|sat|sun) \d{2}:\d{2}$/);

      const twice = computeStaggeredBackupSchedule({ profile: "twice-weekly", systemId: id });
      const parts = parseBackupScheduleParts(twice);
      expect(parts.days).toHaveLength(2);
      const i0 = BACKUP_DOW.indexOf(parts.days[0]);
      const i1 = BACKUP_DOW.indexOf(parts.days[1]);
      expect(weekdayGapDays(i0, i1)).toBeGreaterThanOrEqual(3);
    }
    expect(computeStaggeredBackupSchedule({ profile: "hourly", systemId: "x" })).toBe("hourly");
  });

  it("weekly cohort spreads across days via index", () => {
    const days = new Set();
    for (let i = 0; i < 14; i++) {
      const s = computeStaggeredBackupSchedule({
        profile: "weekly",
        systemId: `guest-${i}`,
        index: i,
        total: 14,
      });
      days.add(s.split(" ")[0]);
    }
    expect(days.size).toBe(7);
  });

  it("formatNightTime and hashStringToUint are stable", () => {
    expect(formatNightTime(0)).toBe("00:00");
    expect(formatNightTime(359)).toBe("05:59");
    expect(hashStringToUint("a")).toBe(hashStringToUint("a"));
  });

  it("applyStaggeredSchedulesToTargets updates schedules", () => {
    const targets = [
      {
        systemId: "alpha-a",
        backup: resolveBackupSpec(proxmoxCfg, { profile: "weekly" }, { systemId: "alpha-a", applyStagger: false }),
      },
      {
        systemId: "beta-a",
        backup: resolveBackupSpec(proxmoxCfg, { profile: "weekly" }, { systemId: "beta-a", applyStagger: false }),
      },
    ];
    applyStaggeredSchedulesToTargets(targets, proxmoxCfg);
    expect(targets[0].backup.schedule).toMatch(/^(mon|tue|wed|thu|fri|sat|sun) /);
    expect(targets[1].backup.schedule).toMatch(/^(mon|tue|wed|thu|fri|sat|sun) /);
  });

  it("backup frequency tags map from profiles", () => {
    expect(backupFrequencyTagForProfile("hourly")).toBe("backup-hourly");
    expect(backupFrequencyTagForProfile("twice-weekly")).toBe("backup-twice-weekly");
    expect(BACKUP_FREQUENCY_TAGS).toContain("backup-weekly");

    const merged = mergeBackupFrequencyTag("bind;backup-weekly", "daily");
    expect(merged.changed).toBe(true);
    expect(merged.tags).toEqual(["bind", "backup-daily"]);
    expect(merged.desiredTag).toBe("backup-daily");

    const same = mergeBackupFrequencyTag("bind;backup-daily", "daily");
    expect(same.changed).toBe(false);
    expect(parseProxmoxTags("bind;backup-daily")).toContain("backup-daily");
  });

  it("collectDeploymentsFromPackageData includes deployment_groups", () => {
    const rows = collectDeploymentsFromPackageData({
      deployments: [{ system_id: "top-a" }],
      deployment_groups: [{ id: "g", deployments: [{ system_id: "nested-a" }, { system_id: "nested-b" }] }],
    });
    expect(rows.map((r) => r.system_id)).toEqual(["top-a", "nested-a", "nested-b"]);
  });

  it("collectClusterOrphanBackupTargets defaults to weekly", () => {
    const orphans = collectClusterOrphanBackupTargets({
      resources: [
        { vmid: 100, name: "orphan-a", node: "pve-a", type: "lxc", template: 0 },
        { vmid: 101, name: "covered-a", node: "pve-a", type: "qemu", template: 0 },
        { vmid: 900, name: "tmpl", node: "pve-a", type: "qemu", template: 1 },
      ],
      coveredVmids: new Set([101]),
      cfg: proxmoxCfg,
      hostId: "pve-a",
    });
    expect(orphans).toHaveLength(1);
    expect(orphans[0].systemId).toBe("orphan-a");
    expect(orphans[0].backup.profile).toBe("weekly");
    expect(orphans[0].backup.frequency_tag).toBe("backup-weekly");
    expect(orphans[0].backup.schedule).toMatch(/^(mon|tue|wed|thu|fri|sat|sun) /);
  });

  it("buildBackupJobBody uses API prune-backups string", () => {
    const body = buildBackupJobBody(
      { systemId: "vaultwarden-a", vmid: 488 },
      resolveBackupSpec(proxmoxCfg, { profile: "hourly" }),
      "hdc-backup",
      proxmoxCfg,
    );
    expect(body.id).toBe("hdc-backup-vaultwarden-a");
    expect(body.vmid).toBe("488");
    expect(body["prune-backups"]).toBe("keep-last=3,keep-daily=7");
    expect(body.comment).toBe("hdc-managed: vaultwarden-a");
    expect(body["notification-mode"]).toBe("notification-system");
  });

  it("backupJobsMatch rejects legacy mailto on live jobs", () => {
    const desired = {
      enabled: 1,
      storage: "nas-1",
      schedule: "hourly",
      vmid: "488",
      mode: "snapshot",
      compress: "zstd",
      "prune-backups": "keep-last=3,keep-daily=7",
      comment: "hdc-managed: vaultwarden-a",
      "notification-mode": "notification-system",
    };
    const live = { ...desired, mailto: "ops@example.invalid", "notification-mode": "auto" };
    expect(backupJobsMatch(desired, live)).toBe(false);
    expect(backupJobLegacyMailFields(live)).toEqual(["mailto"]);
    expect(buildBackupJobPutForm(desired, live)).toContain("delete=mailto");
  });

  it("backupJobsMatch compares normalized prune-backups", () => {
    const desired = {
      enabled: 1,
      storage: "nas-1",
      schedule: "hourly",
      vmid: "488",
      mode: "snapshot",
      compress: "zstd",
      "prune-backups": "keep-last=3,keep-daily=7",
      comment: "hdc-managed: vaultwarden-a",
    };
    const live = {
      ...desired,
      "prune-backups": { "keep-last": "3", "keep-daily": "7" },
    };
    expect(backupJobsMatch(desired, live)).toBe(true);
    expect(backupJobsMatch(desired, { ...desired, schedule: "daily" })).toBe(false);
  });

  it("deploymentBackupRow respects enabled false", () => {
    expect(
      deploymentBackupRow(
        {
          system_id: "vaultwarden-a",
          proxmox: { host_id: "pve-a", lxc: { vmid: 488 } },
          backup: { enabled: false },
        },
        null,
      ),
    ).toBeNull();
  });

  it("deploymentBackupRow collects vmid and lookup name", () => {
    const row = deploymentBackupRow(
      {
        system_id: "vm-bind-a",
        hostname: "bind-a",
        proxmox: { host_id: "pve-b", qemu: { ip: "192.0.2.2/24" } },
      },
      { profile: "daily" },
    );
    expect(row?.systemId).toBe("vm-bind-a");
    expect(row?.hostId).toBe("pve-b");
    expect(row?.vmid).toBeNull();
    expect(row?.lookupName).toBe("bind-a");
  });

  it("storageSupportsBackup checks content types", () => {
    const rows = [{ storage: "nas-1", content: "backup,iso" }];
    expect(storageSupportsBackup(rows, "nas-1").ok).toBe(true);
    expect(storageSupportsBackup(rows, "local-lvm").ok).toBe(false);
    expect(storageSupportsBackup(rows, "local-lvm").reason).toBe("storage not found");
    expect(storageSupportsBackup([{ storage: "nas-1", content: "images" }], "nas-1").reason).toBe(
      "storage content missing backup",
    );
  });

  it("collectBackupTargetsFromPackages reads service defaults.backup", () => {
    const targets = collectBackupTargetsFromPackages(process.cwd(), proxmoxCfg);
    const vault = targets.find((t) => t.systemId === "vaultwarden-a");
    expect(vault?.backup.profile).toBe("hourly");
    expect(vault?.backup.frequency_tag).toBe("backup-hourly");
    const bind = targets.find((t) => t.systemId === "vm-bind-a");
    expect(bind?.backup.profile).toBe("daily");
    expect(bind?.backup.schedule).toMatch(/^\d{2}:\d{2}$/);
  });
});
