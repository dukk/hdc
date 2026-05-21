import { describe, expect, it } from "vitest";
import {
  cloudImageFilenameFromUrl,
  DEFAULT_QEMU_CLOUD_IMAGE,
  qemuTemplateBuildSpecFromConfig,
} from "../../../packages/infrastructure/proxmox/lib/proxmox-qemu-template-build.mjs";

describe("proxmox qemu template build", () => {
  it("cloudImageFilenameFromUrl uses URL basename", () => {
    expect(cloudImageFilenameFromUrl(DEFAULT_QEMU_CLOUD_IMAGE.url)).toBe(
      "ubuntu-22.04-server-cloudimg-amd64.img",
    );
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
