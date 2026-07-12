import { describe, expect, it } from "vitest";
import { resolveDiskFormat, scsi0VolumeSpec } from "../../../clumps/services/windows-desktop/lib/disk-format.mjs";
import {
  normalizeSha256,
  windowsIsoRemotePath,
} from "../../../clumps/services/windows-desktop/lib/windows-iso-ensure.mjs";

describe("disk-format", () => {
  it("defaults to raw on local-lvm", () => {
    expect(resolveDiskFormat({}, "local-lvm")).toBe("raw");
  });

  it("honors explicit disk_format", () => {
    expect(resolveDiskFormat({ disk_format: "qcow2" }, "local-lvm")).toBe("qcow2");
  });

  it("scsi0VolumeSpec includes format", () => {
    expect(scsi0VolumeSpec("local-lvm", 128, "raw")).toBe("local-lvm:128,format=raw");
  });
});

describe("windows-iso-ensure", () => {
  it("normalizeSha256 strips sha256: prefix", () => {
    const hex = "a".repeat(64);
    expect(normalizeSha256(`sha256:${hex}`)).toBe(hex);
  });

  it("windowsIsoRemotePath derives remote path from volid", () => {
    expect(windowsIsoRemotePath({ windows_volid: "local:iso/Win11.iso" }, "local")).toEqual({
      storage: "local",
      basename: "Win11.iso",
      remotePath: "/var/lib/vz/template/iso/Win11.iso",
      volid: "local:iso/Win11.iso",
    });
  });
});
