import { describe, expect, it } from "vitest";
import {
  appendReplicateFlagToDiskValue,
  buildReplicationJobBody,
  deploymentReplicationRow,
  hdcManagedReplicationComment,
  isHdcManagedReplicationComment,
  replicationJobIdForGuest,
  replicationJobsMatch,
  replicationProfilesFromConfig,
  resolveReplicationSpec,
  parseStorageIdFromDiskValue,
  storageTypeSupportsReplication,
} from "../../../clumps/infrastructure/proxmox/lib/proxmox-replication-maintain.mjs";

const proxmoxCfg = {
  provision: {
    replication: {
      default_profile: "frequent",
      profiles: {
        frequent: { schedule: "*/15" },
        hourly: { schedule: "*/00" },
      },
    },
  },
};

describe("proxmox replication maintain", () => {
  it("replicationJobIdForGuest uses vmid-suffix format", () => {
    expect(replicationJobIdForGuest(110, 0)).toBe("110-0");
    expect(replicationJobIdForGuest(502, 1)).toBe("502-1");
  });

  it("hdcManagedReplicationComment is stable", () => {
    expect(hdcManagedReplicationComment("vm-bind-a")).toBe("hdc-managed: vm-bind-a");
    expect(isHdcManagedReplicationComment("hdc-managed: vm-bind-a", "vm-bind-a")).toBe(true);
    expect(isHdcManagedReplicationComment("hdc-managed: vm-bind-a", "vm-bind-b")).toBe(false);
  });

  it("resolveReplicationSpec merges profile and overrides", () => {
    const spec = resolveReplicationSpec(proxmoxCfg, {
      target_host_id: "pve-c",
      profile: "hourly",
    });
    expect(spec.profile).toBe("hourly");
    expect(spec.schedule).toBe("*/00");
    expect(spec.target_host_id).toBe("pve-c");

    const custom = resolveReplicationSpec(proxmoxCfg, {
      schedule: "daily",
      target_host_id: "pve-b",
      rate: 10,
    });
    expect(custom.schedule).toBe("daily");
    expect(custom.rate).toBe(10);
  });

  it("replicationProfilesFromConfig merges defaults with config", () => {
    const profiles = replicationProfilesFromConfig(proxmoxCfg);
    expect(profiles.frequent.schedule).toBe("*/15");
    expect(profiles.daily.schedule).toBe("daily");
  });

  it("buildReplicationJobBody uses Proxmox replication fields", () => {
    const body = buildReplicationJobBody(
      { systemId: "pi-hole-a", vmid: 110 },
      resolveReplicationSpec(proxmoxCfg, { target_host_id: "pve-c", rate: 5 }),
      "pve-c",
    );
    expect(body.id).toBe("110-0");
    expect(body.type).toBe("local");
    expect(body.target).toBe("pve-c");
    expect(body.schedule).toBe("*/15");
    expect(body.rate).toBe(5);
    expect(body.comment).toBe("hdc-managed: pi-hole-a");
  });

  it("replicationJobsMatch compares schedule and target", () => {
    const desired = {
      type: "local",
      target: "pve-c",
      schedule: "*/15",
      comment: "hdc-managed: pi-hole-a",
      disable: 0,
    };
    expect(replicationJobsMatch(desired, { ...desired })).toBe(true);
    expect(replicationJobsMatch(desired, { ...desired, target: "pve-b" })).toBe(false);
  });

  it("deploymentReplicationRow respects enabled false", () => {
    expect(
      deploymentReplicationRow(
        {
          system_id: "pi-hole-a",
          proxmox: { host_id: "pve-b", lxc: { vmid: 110 } },
          replication: { enabled: false },
        },
        null,
      ),
    ).toBeNull();
    const row = deploymentReplicationRow(
      {
        system_id: "vm-bind-a",
        proxmox: { host_id: "pve-b", qemu: { vmid: 501 } },
        replication: { target_host_id: "pve-c" },
      },
      { enabled: true },
    );
    expect(row?.systemId).toBe("vm-bind-a");
    expect(row?.vmid).toBe(501);
  });

  it("appendReplicateFlagToDiskValue adds replicate=1", () => {
    expect(appendReplicateFlagToDiskValue("local-lvm:vm-110-disk-0,size=8G")).toBe(
      "local-lvm:vm-110-disk-0,size=8G,replicate=1",
    );
    expect(appendReplicateFlagToDiskValue("local-lvm:vm-110-disk-0,replicate=1")).toBeNull();
    expect(appendReplicateFlagToDiskValue("local-lvm:iso/foo.iso,media=cdrom")).toBeNull();
    expect(appendReplicateFlagToDiskValue("local-lvm:vm-110-disk-0,replicate=0")).toBe(
      "local-lvm:vm-110-disk-0,replicate=1",
    );
  });

  it("parseStorageIdFromDiskValue extracts storage id", () => {
    expect(parseStorageIdFromDiskValue("local-lvm:vm-110-disk-0,size=8G")).toBe("local-lvm");
    expect(parseStorageIdFromDiskValue("local:iso/foo.iso,media=cdrom")).toBeNull();
  });

  it("storageTypeSupportsReplication is ZFS-only", () => {
    expect(storageTypeSupportsReplication("zfspool")).toBe(true);
    expect(storageTypeSupportsReplication("zfs")).toBe(true);
    expect(storageTypeSupportsReplication("lvmthin")).toBe(false);
    expect(storageTypeSupportsReplication("dir")).toBe(false);
  });
});
