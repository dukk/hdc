import { describe, expect, it } from "vitest";
import {
  buildHaGroupBody,
  buildHaNodeAffinityRuleBody,
  buildHaResourceBody,
  deploymentHaRow,
  haGroupsFromConfig,
  haGroupsMatch,
  haNodeAffinityRulesMatch,
  haResourceSid,
  haResourcesMatch,
  hdcManagedHaComment,
  isHdcManagedHaComment,
  resolveHaSpec,
} from "../../../packages/infrastructure/proxmox/lib/proxmox-ha-maintain.mjs";

const proxmoxCfg = {
  provision: {
    ha: {
      groups: {
        "hdc-dns": { nodes: ["pve-b", "pve-c"] },
      },
      defaults: {
        group: "hdc-dns",
        max_restart: 3,
        max_relocate: 2,
        state: "started",
      },
    },
  },
};

const hostToNode = new Map([
  ["pve-b", "pve-b"],
  ["pve-c", "pve-c"],
]);

describe("proxmox HA maintain", () => {
  it("haResourceSid formats vm and ct sids", () => {
    expect(haResourceSid("qemu", 501)).toBe("vm:501");
    expect(haResourceSid("lxc", 110)).toBe("ct:110");
  });

  it("hdcManagedHaComment is stable", () => {
    expect(hdcManagedHaComment("pi-hole-a")).toBe("hdc-managed: pi-hole-a");
    expect(isHdcManagedHaComment("hdc-managed: pi-hole-a")).toBe(true);
  });

  it("resolveHaSpec merges defaults", () => {
    const spec = resolveHaSpec(proxmoxCfg, { enabled: true });
    expect(spec.enabled).toBe(true);
    expect(spec.group).toBe("hdc-dns");
    expect(spec.max_restart).toBe(3);
    expect(spec.state).toBe("started");

    const disabled = resolveHaSpec(proxmoxCfg, { enabled: false });
    expect(disabled.enabled).toBe(false);
  });

  it("haGroupsFromConfig reads node lists", () => {
    const groups = haGroupsFromConfig(proxmoxCfg);
    expect(groups["hdc-dns"].nodes).toEqual(["pve-b", "pve-c"]);
  });

  it("buildHaGroupBody maps host ids to pve nodes", () => {
    const body = buildHaGroupBody("hdc-dns", haGroupsFromConfig(proxmoxCfg)["hdc-dns"], hostToNode);
    expect(body.group).toBe("hdc-dns");
    expect(body.nodes).toBe("pve-b,pve-c");
    expect(body.restricted).toBe(0);
  });

  it("buildHaNodeAffinityRuleBody lists resources and nodes", () => {
    const body = buildHaNodeAffinityRuleBody(
      "hdc-dns",
      haGroupsFromConfig(proxmoxCfg)["hdc-dns"],
      hostToNode,
      ["vm:501", "ct:110"],
    );
    expect(body.type).toBe("node-affinity");
    expect(body.rule).toBe("hdc-dns");
    expect(body.nodes).toBe("pve-b,pve-c");
    expect(body.resources).toBe("ct:110,vm:501");
  });

  it("haNodeAffinityRulesMatch normalizes resource lists", () => {
    const desired = {
      type: "node-affinity",
      nodes: "pve-b,pve-c",
      resources: "vm:501,ct:110",
      strict: 0,
      comment: "hdc-managed group hdc-dns",
    };
    const live = { ...desired, resources: "ct:110,vm:501" };
    expect(haNodeAffinityRulesMatch(desired, live)).toBe(true);
  });

  it("buildHaResourceBody sets sid and comment", () => {
    const body = buildHaResourceBody(
      { systemId: "vm-bind-a", vmid: 501 },
      resolveHaSpec(proxmoxCfg, { enabled: true }),
      "qemu",
    );
    expect(body.sid).toBe("vm:501");
    expect(body.group).toBe("hdc-dns");
    expect(body.comment).toBe("hdc-managed: vm-bind-a");
  });

  it("haGroupsMatch normalizes node order", () => {
    const desired = {
      nodes: "pve-c,pve-b",
      restricted: 0,
      nofailback: 0,
      comment: "hdc-managed group hdc-dns",
    };
    const live = {
      nodes: "pve-b,pve-c",
      restricted: 0,
      nofailback: 0,
      comment: "hdc-managed group hdc-dns",
    };
    expect(haGroupsMatch(desired, live)).toBe(true);
  });

  it("haResourcesMatch compares HA resource fields", () => {
    const desired = {
      state: "started",
      group: "hdc-dns",
      max_restart: 3,
      max_relocate: 2,
      comment: "hdc-managed: pi-hole-a",
    };
    expect(haResourcesMatch(desired, desired)).toBe(true);
    expect(haResourcesMatch(desired, { ...desired, group: "other" })).toBe(false);
  });

  it("deploymentHaRow respects enabled false", () => {
    expect(
      deploymentHaRow(
        {
          system_id: "pi-hole-a",
          proxmox: { host_id: "pve-b", lxc: { vmid: 110 } },
          ha: { enabled: false },
        },
        { enabled: true },
      ),
    ).toBeNull();
    const row = deploymentHaRow(
      {
        system_id: "pi-hole-a",
        proxmox: { host_id: "pve-b", lxc: { vmid: 110 } },
      },
      { enabled: true },
    );
    expect(row?.systemId).toBe("pi-hole-a");
  });
});
