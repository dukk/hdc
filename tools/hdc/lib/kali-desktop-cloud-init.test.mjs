import { describe, expect, it } from "vitest";

import { buildKaliCloudInitFields } from "../../../packages/services/kali-desktop/lib/proxmox-kali-cloud-init.mjs";

describe("buildKaliCloudInitFields", () => {
  it("sets ciuser, cipassword, and ipconfig for Kali", () => {
    const { fields, sshBlob, keyCount } = buildKaliCloudInitFields({
      hostname: "kali-a",
      ipCidr: "192.0.2.189/24",
      gateway: "192.0.2.1",
      ciuser: "kali",
      cipassword: "test-pass",
      dnsServers: ["192.0.2.2", "192.0.2.3"],
      publicKeyLines: ["ssh-ed25519 AAAA comment"],
    });

    expect(fields.ciuser).toBe("kali");
    expect(fields.cipassword).toBe("test-pass");
    expect(fields.ipconfig0).toBe("ip=192.0.2.189/24,gw=192.0.2.1,dns=192.0.2.2+192.0.2.3");
    expect(fields.name).toBe("kali-a");
    expect(fields.ciupgrade).toBe(0);
    expect(keyCount).toBe(1);
    expect(sshBlob).toBeTruthy();
  });

  it("omits cipassword when empty", () => {
    const { fields } = buildKaliCloudInitFields({
      hostname: "kali-a",
      ipCidr: "192.0.2.189/24",
      gateway: "192.0.2.1",
      ciuser: "kali",
      cipassword: "",
    });
    expect(fields.cipassword).toBeUndefined();
  });
});
