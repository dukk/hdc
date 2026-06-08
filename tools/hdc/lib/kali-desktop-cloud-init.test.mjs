import { describe, expect, it } from "vitest";

import { buildKaliCloudInitFields } from "../../../packages/services/kali-desktop/lib/proxmox-kali-cloud-init.mjs";

describe("buildKaliCloudInitFields", () => {
  it("sets ciuser, cipassword, and ipconfig for Kali", () => {
    const { fields, sshBlob, keyCount } = buildKaliCloudInitFields({
      hostname: "kali-a",
      ipCidr: "10.0.0.189/24",
      gateway: "10.0.0.1",
      ciuser: "kali",
      cipassword: "test-pass",
      publicKeyLines: ["ssh-ed25519 AAAA comment"],
    });

    expect(fields.ciuser).toBe("kali");
    expect(fields.cipassword).toBe("test-pass");
    expect(fields.ipconfig0).toBe("ip=10.0.0.189/24,gw=10.0.0.1");
    expect(fields.name).toBe("kali-a");
    expect(fields.ciupgrade).toBe(0);
    expect(keyCount).toBe(1);
    expect(sshBlob).toBeTruthy();
  });

  it("omits cipassword when empty", () => {
    const { fields } = buildKaliCloudInitFields({
      hostname: "kali-a",
      ipCidr: "10.0.0.189/24",
      gateway: "10.0.0.1",
      ciuser: "kali",
      cipassword: "",
    });
    expect(fields.cipassword).toBeUndefined();
  });
});
