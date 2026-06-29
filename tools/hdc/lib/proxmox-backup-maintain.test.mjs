import { describe, expect, it } from "vitest";
import {
  backupJobIdForSystem,
  backupJobIdPrefixFromConfig,
  backupJobLegacyMailFields,
  backupJobsMatch,
  backupProfilesFromConfig,
  buildBackupJobBody,
  buildBackupJobPutForm,
  collectBackupTargetsFromPackages,
  deploymentBackupRow,
  normalizePruneBackups,
  resolveBackupSpec,
  storageSupportsBackup,
} from "../../../packages/infrastructure/proxmox/lib/proxmox-backup-maintain.mjs";

const proxmoxCfg = {
  provision: {
    backups: {
      default_storage: "nas-1",
      default_profile: "weekly",
      profiles: {
        weekly: { schedule: "sun 03:00", prune_backups: "keep-last=3", mode: "snapshot", compress: "zstd" },
        hourly: { schedule: "hourly", prune_backups: "keep-daily=7,keep-last=3", mode: "snapshot", compress: "zstd" },
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
    expect(spec.prune_backups).toBe("keep-daily=7,keep-last=3");

    const custom = resolveBackupSpec(proxmoxCfg, { schedule: "daily", prune_backups: "keep-last=5" });
    expect(custom.schedule).toBe("daily");
    expect(custom.prune_backups).toBe("keep-last=5");
    expect(custom.profile).toBe("weekly");
  });

  it("backupProfilesFromConfig merges defaults with config", () => {
    const profiles = backupProfilesFromConfig(proxmoxCfg);
    expect(profiles.weekly.schedule).toBe("sun 03:00");
    expect(profiles.daily.schedule).toBe("daily");
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
    expect(body["prune-backups"]).toBe("keep-daily=7,keep-last=3");
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
      "prune-backups": "keep-daily=7,keep-last=3",
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
      "prune-backups": "keep-daily=7,keep-last=3",
      comment: "hdc-managed: vaultwarden-a",
    };
    const live = {
      ...desired,
      "prune-backups": { "keep-daily": "7", "keep-last": "3" },
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
    const bind = targets.find((t) => t.systemId === "vm-bind-a");
    expect(bind?.backup.profile).toBe("daily");
  });
});
