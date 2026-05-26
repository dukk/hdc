import { describe, expect, it } from "vitest";
import {
  cloudImageDownloadFilename,
  cloudImageFilenameFromUrl,
  DEFAULT_QEMU_CLOUD_IMAGE,
  isIncompleteQemuTemplateBuild,
  qemuTemplateBuildSpecFromConfig,
} from "../../../packages/infrastructure/proxmox/lib/proxmox-qemu-template-build.mjs";
import { pveProfileForMajor } from "../../../packages/infrastructure/proxmox/lib/pve-version.mjs";

describe("proxmox qemu template build", () => {
  it("cloudImageFilenameFromUrl uses URL basename", () => {
    expect(cloudImageFilenameFromUrl(DEFAULT_QEMU_CLOUD_IMAGE.url)).toBe(
      "ubuntu-22.04-server-cloudimg-amd64.img",
    );
  });

  it("cloudImageDownloadFilename uses .qcow2 on PVE 9 and .img on PVE 8", () => {
    const url = DEFAULT_QEMU_CLOUD_IMAGE.url;
    expect(cloudImageDownloadFilename(url, pveProfileForMajor(9))).toBe(
      "ubuntu-22.04-server-cloudimg-amd64.qcow2",
    );
    expect(cloudImageDownloadFilename(url, pveProfileForMajor(8))).toBe(
      "ubuntu-22.04-server-cloudimg-amd64.img",
    );
  });

  it("isIncompleteQemuTemplateBuild detects shell VMs without disk", () => {
    expect(isIncompleteQemuTemplateBuild({ template: false, maxdisk: 0 })).toBe(true);
    expect(isIncompleteQemuTemplateBuild({ template: false, maxdisk: 1 })).toBe(false);
    expect(isIncompleteQemuTemplateBuild({ template: true, maxdisk: 0 })).toBe(false);
  });

  it("qemuTemplateBuildSpecFromConfig reads build defaults", () => {
    const spec = qemuTemplateBuildSpecFromConfig({
      provision: {
        qemu: {
          template_vmid: 9022,
          storage: "local-lvm",
          image_storage: "local",
          build_template: true,
        },
      },
    });
    expect(spec).not.toBeNull();
    expect(spec?.templateVmid).toBe(9022);
    expect(spec?.storage).toBe("local-lvm");
    expect(spec?.imageStorage).toBe("local");
    expect(spec?.cloudImageUrl).toContain("cloud-images.ubuntu.com");
  });

  it("qemuTemplateBuildSpecFromConfig returns null when build_template is false", () => {
    expect(
      qemuTemplateBuildSpecFromConfig({
        provision: { qemu: { template_vmid: 9000, build_template: false } },
      }),
    ).toBeNull();
  });
});
