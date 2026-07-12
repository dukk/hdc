import { describe, expect, it } from "vitest";
import { storageSpecToFormFields } from "../../../clumps/infrastructure/proxmox/lib/proxmox-storage-maintain.mjs";
import {
  parsePveVersionBody,
  parsePveVersionFromCli,
  pveMajorFromRelease,
  pveProfileForMajor,
  pveVersionFromConfigCluster,
  resolveClusterPveProfile,
} from "../../../clumps/infrastructure/proxmox/lib/pve-version.mjs";

describe("pve version", () => {
  it("parsePveVersionBody reads release and major", () => {
    const v = parsePveVersionBody({ data: { release: "8.4", version: "8.4.19", repoid: "abc" } });
    expect(v).toEqual({ major: 8, release: "8.4", version: "8.4.19", repoid: "abc" });
    const v9 = parsePveVersionBody({ data: { release: "9.0", version: "9.0.4" } });
    expect(v9?.major).toBe(9);
  });

  it("pveMajorFromRelease maps 8 and 9 only", () => {
    expect(pveMajorFromRelease("8.4")).toBe(8);
    expect(pveMajorFromRelease("9")).toBe(9);
    expect(pveMajorFromRelease("7.4")).toBeNull();
  });

  it("parsePveVersionFromCli parses pve-manager line", () => {
    const v = parsePveVersionFromCli("pve-manager/9.0.4/abc123 (running kernel: 6.14.8-2-pve)");
    expect(v?.major).toBe(9);
    expect(v?.release).toBe("9.0");
  });

  it("pveProfileForMajor adds Sys.AccessNetwork on pve9", () => {
    const p8 = pveProfileForMajor(8);
    const p9 = pveProfileForMajor(9);
    expect(p8.id).toBe("pve8");
    expect(p9.id).toBe("pve9");
    expect(p9.apiTokenPrivileges).toContain("Sys.AccessNetwork");
    expect(p8.apiTokenPrivileges).not.toContain("Sys.AccessNetwork");
    expect(p8.apiTokenPrivileges).toContain("VM.Monitor");
    expect(p9.apiTokenPrivileges).not.toContain("VM.Monitor");
  });

  it("pveVersionFromConfigCluster uses pve_release", () => {
    expect(pveVersionFromConfigCluster({ pve_release: "9.0" })?.major).toBe(9);
  });

  it("resolveClusterPveProfile prefers config when no API", async () => {
    const r = await resolveClusterPveProfile({
      configCluster: { pve_release: "8.4" },
    });
    expect(r?.profile.id).toBe("pve8");
  });

  it("storageSpecToFormFields uses profile storageUpdateKeys on update", () => {
    const profile = pveProfileForMajor(8);
    const fields = storageSpecToFormFields(
      {
        storage: "nas-a",
        type: "nfs",
        server: "192.0.2.9",
        export: "/vol",
        path: "/mnt/pve/nas-a",
        nodes: "hypervisor-a",
      },
      {},
      { forUpdate: true, profile },
    );
    expect(fields).toEqual({ nodes: "hypervisor-a" });
  });
});
