import { describe, expect, it } from "vitest";
import { parseStorageVolid } from "../../../clumps/infrastructure/proxmox/lib/proxmox-config.mjs";
import {
  applianceTemplateFromVolid,
  provisionRequirementsFromConfig,
  pveAuthFailureHint,
} from "../../../clumps/infrastructure/proxmox/lib/proxmox-maintain-templates.mjs";

describe("proxmox maintain templates", () => {
  it("parseStorageVolid splits storage and volid", () => {
    expect(parseStorageVolid("local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.zst")).toEqual({
      storage: "local",
      volid: "local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.zst",
    });
    expect(parseStorageVolid("bad")).toBeNull();
  });

  it("pveAuthFailureHint mentions per-host token on 401", () => {
    expect(pveAuthFailureHint("Proxmox HTTP 401 /cluster/resources")).toContain("HDC_PROXMOX_API_TOKEN");
    expect(pveAuthFailureHint("other error")).toBe("");
  });

  it("applianceTemplateFromVolid extracts catalog filename", () => {
    expect(applianceTemplateFromVolid("local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.zst")).toBe(
      "ubuntu-22.04-standard_22.04-1_amd64.tar.zst",
    );
    expect(applianceTemplateFromVolid("bad")).toBeNull();
  });

  it("provisionRequirementsFromConfig resolves defaults from Ubuntu LTS catalog", () => {
    const req = provisionRequirementsFromConfig({
      provision: {
        templates: { policy: "ubuntu-lts" },
        lxc: { ostemplate_storage: "local", default_release: "24.04" },
        qemu: { default_release: "24.04" },
      },
    });
    expect(req.lxcOstemplate).toBe("local:vztmpl/ubuntu-24.04-standard_24.04-2_amd64.tar.zst");
    expect(req.qemuTemplateVmid).toBe(9024);
    expect(req.defaultRelease).toBe("24.04");
  });
});
