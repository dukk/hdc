import { describe, expect, it } from "vitest";
import {
  allowedUbuntuQemuTemplateVmids,
  isAllowedUbuntuLxcAppliance,
  lxcVolidForAppliance,
  ubuntuLtsByRelease,
} from "../../../packages/infrastructure/proxmox/lib/ubuntu-lts-catalog.mjs";
import { lxcVolidsToPrune, qemuTemplatesToPrune } from "../../../packages/infrastructure/proxmox/lib/proxmox-template-prune.mjs";

describe("ubuntu LTS catalog", () => {
  it("includes 22.04, 24.04, 26.04", () => {
    expect(ubuntuLtsByRelease("22.04")?.qemuTemplateVmid).toBe(9022);
    expect(ubuntuLtsByRelease("24.04")?.qemuTemplateVmid).toBe(9024);
    expect(ubuntuLtsByRelease("26.04")?.qemuTemplateVmid).toBe(9026);
    expect(ubuntuLtsByRelease("20.04")).toBeNull();
  });

  it("lxcVolidsToPrune removes EOL ubuntu vztmpl", () => {
    const storage = "local";
    const keep = lxcVolidForAppliance(storage, "ubuntu-22.04-standard_22.04-1_amd64.tar.zst");
    const drop = lxcVolidForAppliance(storage, "ubuntu-20.04-standard_20.04-1_amd64.tar.zst");
    const pruned = lxcVolidsToPrune([keep, drop, `${storage}:vztmpl/debian-12-standard.tar.zst`]);
    expect(pruned).toEqual([drop]);
    expect(isAllowedUbuntuLxcAppliance("ubuntu-22.04-standard_22.04-1_amd64.tar.zst")).toBe(true);
    expect(isAllowedUbuntuLxcAppliance("ubuntu-20.04-standard_20.04-1_amd64.tar.zst")).toBe(false);
  });

  it("qemuTemplatesToPrune removes hdc templates outside catalog", () => {
    const resources = [
      { vmid: 9022, node: "hypervisor-a", name: "tpl-ubuntu-2204", template: 1, type: "qemu" },
      { vmid: 9000, node: "hypervisor-a", name: "tpl-ubuntu-2204", template: 1, type: "qemu" },
      { vmid: 100, node: "hypervisor-a", name: "user-template", template: 1, type: "qemu" },
    ];
    const pruned = qemuTemplatesToPrune(resources);
    expect(pruned.map((t) => t.vmid)).toEqual([9000]);
    expect(allowedUbuntuQemuTemplateVmids().has(9022)).toBe(true);
    expect(allowedUbuntuQemuTemplateVmids().has(9000)).toBe(false);
  });
});
