import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  apiBaseFromHostRecord,
  apiBaseFromWebUi,
  findProxmoxHostInConfig,
  isProxmoxHostDown,
  loadProxmoxHostsByCluster,
  proxmoxClusterRefFromHost,
  resolveProxmoxHost,
} from "../../../clumps/infrastructure/proxmox/lib/proxmox-config.mjs";
import {
  formatTemplateNotFoundMessage,
  listQemuGuests,
  listQemuTemplates,
  locateVmidInCluster,
} from "../../../clumps/infrastructure/proxmox/lib/proxmox-host-provisioner.mjs";

const examplePath = join(
  process.cwd(),
  "clumps/infrastructure/proxmox/config.example.json",
);

describe("proxmox-config", () => {
  const cfg = JSON.parse(readFileSync(examplePath, "utf8"));

  it("apiBaseFromWebUi normalizes web UI URL", () => {
    expect(apiBaseFromWebUi("https://192.0.2.11:8006")).toBe("https://192.0.2.11:8006");
  });

  it("resolveProxmoxHost finds host by web_ui", () => {
    const h = resolveProxmoxHost(cfg, "hypervisor-a");
    expect(h).not.toBeNull();
    expect(h?.apiBase).toBe("https://192.0.2.11:8006");
    expect(h?.clusterId).toBe("example-proxmox-cluster");
    expect(h?.ssh).toBe("ssh://root@192.0.2.11");
  });

  it("loadProxmoxHostsByCluster groups by cluster id", () => {
    const map = loadProxmoxHostsByCluster(cfg, {
      configPath: "/x/config.json",
      configRel: "clumps/infrastructure/proxmox/config.json",
    });
    expect(map.has("example-proxmox-cluster")).toBe(true);
    expect(map.has("example-proxmox-standalone")).toBe(true);
    expect(map.get("example-proxmox-cluster")?.length).toBe(2);
  });

  it("isProxmoxHostDown is true for down true or 1", () => {
    expect(isProxmoxHostDown({ down: true })).toBe(true);
    expect(isProxmoxHostDown({ down: 1 })).toBe(true);
    expect(isProxmoxHostDown({ down: false })).toBe(false);
    expect(isProxmoxHostDown({})).toBe(false);
  });

  it("loadProxmoxHostsByCluster excludes hosts marked down", () => {
    const withDown = structuredClone(cfg);
    withDown.clusters[0].hosts[0].down = true;
    const skipped = [];
    const map = loadProxmoxHostsByCluster(withDown, {
      configPath: "/x/config.json",
      configRel: "clumps/infrastructure/proxmox/config.json",
      onSkip: (id, reason) => skipped.push({ id, reason }),
    });
    expect(map.get("example-proxmox-cluster")?.map((m) => m.id)).toEqual(["hypervisor-b"]);
    expect(skipped).toContainEqual({ id: "hypervisor-a", reason: "marked down in config" });
  });

  it("resolveProxmoxHost returns null for down host; findProxmoxHostInConfig still resolves", () => {
    const withDown = structuredClone(cfg);
    withDown.clusters[0].hosts[0].down = true;
    expect(resolveProxmoxHost(withDown, "hypervisor-a")).toBeNull();
    expect(findProxmoxHostInConfig(withDown, "hypervisor-a")?.id).toBe("hypervisor-a");
    expect(resolveProxmoxHost(withDown, "hypervisor-b")?.id).toBe("hypervisor-b");
  });

  it("proxmoxClusterRefFromHost uses cluster id when host has no override", () => {
    const host = cfg.clusters[0].hosts[0];
    expect(proxmoxClusterRefFromHost(host, "example-proxmox-cluster")).toEqual({
      id: "example-proxmox-cluster",
      role: "node",
    });
  });

  it("apiBaseFromHostRecord supports legacy api_base", () => {
    const base = apiBaseFromHostRecord(
      { api_base: "https://legacy.example.com:8006" },
      null,
    );
    expect(base).toBe("https://legacy.example.com:8006");
  });

  it("locateVmidInCluster finds template node", () => {
    const resources = [
      { vmid: 100, node: "hypervisor-b", name: "tpl-ubuntu", template: 1, type: "qemu" },
      { vmid: 200, node: "hypervisor-a", name: "vm1", template: 0, type: "qemu" },
    ];
    expect(locateVmidInCluster(resources, 100)).toEqual({
      node: "hypervisor-b",
      name: "tpl-ubuntu",
      template: true,
    });
    expect(locateVmidInCluster(resources, 9000)).toBeNull();
    expect(listQemuTemplates(resources).map((t) => t.vmid)).toEqual([100]);
    expect(listQemuGuests(resources).map((g) => g.vmid)).toEqual([200]);
  });

  it("formatTemplateNotFoundMessage lists guests and list-templates hint when empty", () => {
    const resources = [{ vmid: 200, node: "hypervisor-a", name: "vm1", template: 0, type: "qemu" }];
    const msg = formatTemplateNotFoundMessage(resources, 9000, "hypervisor-a");
    expect(msg).toContain("no QEMU templates were found");
    expect(msg).toContain("vmid 200");
    expect(msg).toContain("list-templates --host hypervisor-a");
  });
});
