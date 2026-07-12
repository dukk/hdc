import { describe, expect, it } from "vitest";
import { isHostProvisioner, vmNotSupportedResult } from "../../../clumps/lib/host-provisioner.mjs";
import { createUbuntuDockerHostProvisioner } from "../../../clumps/infrastructure/ubuntu/lib/ubuntu-docker-host-provisioner.mjs";
import { flagGet, flagNumber, parseArgvFlags } from "../../../clumps/lib/parse-argv-flags.mjs";

describe("parseArgvFlags", () => {
  it("parses boolean flags and pairs", () => {
    expect(parseArgvFlags(["create-container", "--host", "hypervisor-a", "--dry"])).toEqual({
      host: "hypervisor-a",
      dry: "1",
    });
  });
});

describe("flagGet / flagNumber", () => {
  it("returns first matching key", () => {
    const f = { "memory-mb": "4096", x: "y" };
    expect(flagGet(f, "memory_mb", "memory-mb")).toBe("4096");
  });
  it("coerces numbers", () => {
    expect(flagNumber("12", undefined)).toBe(12);
    expect(flagNumber(undefined, 3)).toBe(3);
  });
});

describe("HostProvisioner contract", () => {
  it("ubuntu-docker rejects createVm", async () => {
    const p = createUbuntuDockerHostProvisioner({ sshUser: "u", sshHost: "h" });
    expect(isHostProvisioner(p)).toBe(true);
    const log = { info() {}, warn() {}, error() {} };
    const r = await p.createVm(log, { name: "x", parameters: {} });
    expect(r.ok).toBe(false);
    expect(vmNotSupportedResult("x").ok).toBe(false);
  });
});
