import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  apiBaseFromHostRecord,
  apiBaseFromWebUi,
  loadProxmoxHostsByCluster,
  proxmoxClusterRefFromHost,
  resolveProxmoxHost,
} from "../../../packages/infrastructure/proxmox/lib/proxmox-config.mjs";
import {
  formatTemplateNotFoundMessage,
  listQemuGuests,
  listQemuTemplates,
  locateVmidInCluster,
} from "../../../packages/infrastructure/proxmox/lib/proxmox-host-provisioner.mjs";

const examplePath = join(
  process.cwd(),
  "packages/infrastructure/proxmox/config.example.json",
);

describe("proxmox-config", () => {
  const cfg = JSON.parse(readFileSync(examplePath, "utf8"));

  it("apiBaseFromWebUi normalizes web UI URL", () => {
    expect(apiBaseFromWebUi("https://10.0.0.11:8006")).toBe("https://10.0.0.11:8006");
  });

  it("resolveProxmoxHost finds host by web_ui", () => {
    const h = resolveProxmoxHost(cfg, "pve-a");
    expect(h).not.toBeNull();
    expect(h?.apiBase).toBe("https://10.0.0.11:8006");
    expect(h?.clusterId).toBe("proxmox-primary-cluster");
    expect(h?.ssh).toBe("ssh://root@10.0.0.11");
  });

  it("loadProxmoxHostsByCluster groups by cluster id", () => {
    const map = loadProxmoxHostsByCluster(cfg, {
      configPath: "/x/config.json",
      configRel: "packages/infrastructure/proxmox/config.json",
    });
    expect(map.has("proxmox-primary-cluster")).toBe(true);
    expect(map.has("proxmox-home-standalone")).toBe(true);
    expect(map.get("proxmox-primary-cluster")?.length).toBe(2);
  });

  it("proxmoxClusterRefFromHost uses cluster id when host has no override", () => {
    const host = cfg.clusters[0].hosts[0];
    expect(proxmoxClusterRefFromHost(host, "proxmox-primary-cluster")).toEqual({
      id: "proxmox-primary-cluster",
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
      { vmid: 100, node: "pve-b", name: "tpl-ubuntu", template: 1, type: "qemu" },
      { vmid: 200, node: "pve-a", name: "vm1", template: 0, type: "qemu" },
    ];
    expect(locateVmidInCluster(resources, 100)).toEqual({
      node: "pve-b",
      name: "tpl-ubuntu",
      template: true,
    });
    expect(locateVmidInCluster(resources, 9000)).toBeNull();
    expect(listQemuTemplates(resources).map((t) => t.vmid)).toEqual([100]);
    expect(listQemuGuests(resources).map((g) => g.vmid)).toEqual([200]);
  });

  it("formatTemplateNotFoundMessage lists guests and list-templates hint when empty", () => {
    const resources = [{ vmid: 200, node: "pve-a", name: "vm1", template: 0, type: "qemu" }];
    const msg = formatTemplateNotFoundMessage(resources, 9000, "pve-a");
    expect(msg).toContain("no QEMU templates were found");
    expect(msg).toContain("vmid 200");
    expect(msg).toContain("list-templates --host pve-a");
  });
});
