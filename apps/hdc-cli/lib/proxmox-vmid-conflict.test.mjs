import { describe, expect, it } from "vitest";
import {
  collectClusterVmids,
  isVmidConflictError,
  nextVmidCandidate,
  resolveProvisionVmid,
} from "../../../clumps/infrastructure/proxmox/lib/proxmox-vmid-conflict.mjs";

describe("proxmox-vmid-conflict", () => {
  it("isVmidConflictError matches Proxmox clone/create collisions", () => {
    expect(
      isVmidConflictError(
        "Proxmox HTTP 500 /nodes/hypervisor-b/qemu/9024/clone: unable to create VM 108: config file already exists",
      ),
    ).toBe(true);
    expect(isVmidConflictError("VM 200 already exists")).toBe(true);
    expect(isVmidConflictError("VM ID already in use")).toBe(true);
    expect(isVmidConflictError("template not found")).toBe(false);
  });

  it("collectClusterVmids gathers numeric vmids from resources", () => {
    const used = collectClusterVmids([
      { vmid: 100 },
      { vmid: "200" },
      { vmid: 0 },
      { name: "no-id" },
    ]);
    expect([...used].sort((a, b) => a - b)).toEqual([100, 200]);
  });

  it("nextVmidCandidate skips cluster-used and already-tried ids", () => {
    const used = new Set([108, 110]);
    const taken = new Set([108]);
    expect(nextVmidCandidate(108, used, taken)).toBe(109);
    expect(nextVmidCandidate(109, used, taken)).toBe(109);
    expect(nextVmidCandidate(110, used, taken)).toBe(111);
  });

  it("resolveProvisionVmid prefers provision details", () => {
    expect(
      resolveProvisionVmid(
        { ok: true, details: { vmid: 109, requested_vmid: 108, vmid_reassigned: true } },
        108,
      ),
    ).toBe(109);
    expect(resolveProvisionVmid({ ok: true, details: {} }, 108)).toBe(108);
    expect(resolveProvisionVmid({ ok: false, message: "fail" }, 108)).toBe(108);
  });
});
