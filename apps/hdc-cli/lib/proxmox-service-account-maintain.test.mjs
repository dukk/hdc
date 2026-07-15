import { describe, expect, it } from "vitest";

import {
  PVE_BUILTIN_ROLES,
  parsePveApiTokenSecret,
  proxmoxHostEnvSlug,
  proxmoxWidgetUsernameFromToken,
  pveumCreateTokenIfMissingScript,
  pveumEnsureServiceAccountAclScript,
  pveumEnsureUserScript,
  pveumSetUserPasswordScript,
  serviceAccountsFromConfig,
  validateServiceAccountClusterResources,
} from "hdc/clump/infrastructure/proxmox/lib/proxmox-service-account-maintain.mjs";
import {
  pveumEnsureTokenAclCommand,
  pveumEnsureUserAclCommand,
} from "hdc/clump/infrastructure/proxmox/lib/proxmox-api-token-maintain.mjs";

describe("proxmox service account maintain", () => {
  it("serviceAccountsFromConfig parses enabled accounts", () => {
    const accounts = serviceAccountsFromConfig({
      provision: {
        service_accounts: [
          {
            id: "homepage",
            userid: "homepage@pam",
            tokenid: "homepage",
            password_vault_key: "HDC_PROXMOX_USER_HOMEPAGE_PASSWORD",
            token_vault_key: "HDC_HOMEPAGE_PROXMOX_API_TOKEN",
            role: "PVEAuditor",
          },
          {
            id: "disabled",
            enabled: false,
            userid: "x@pam",
            tokenid: "x",
            password_vault_key: "A",
            token_vault_key: "B",
          },
        ],
      },
    });
    expect(accounts).toHaveLength(1);
    expect(accounts[0].id).toBe("homepage");
    expect(accounts[0].role).toBe("PVEAuditor");
  });

  it("pveumEnsureUserScript branches on user list", () => {
    const script = pveumEnsureUserScript("homepage@pam", "secret", "widget user");
    expect(script).toContain("pveum user list --output-format json");
    expect(script).toContain("useradd -m -s /sbin/nologin 'homepage'");
    expect(script).toContain("pveum user add 'homepage@pam'");
    expect(script).toContain("--comment 'widget user'");
    expect(script).not.toContain("--password 'secret'");
  });

  it("pveumSetUserPasswordScript sets passwd", () => {
    expect(pveumSetUserPasswordScript("homepage@pam", "new")).toContain("chpasswd");
    expect(pveumSetUserPasswordScript("widget@pve", "new")).toContain(
      "pveum passwd 'widget@pve' --password 'new'",
    );
  });

  it("pveumCreateTokenIfMissingScript does not regenerate existing token", () => {
    const script = pveumCreateTokenIfMissingScript("homepage@pam", "homepage");
    expect(script).toContain("pveum user token list 'homepage@pam'");
    expect(script).toContain("pveum user token add 'homepage@pam' 'homepage' --privsep 1");
    expect(script).not.toContain("--regenerate");
  });

  it("pveumEnsureServiceAccountAclScript sets user and token ACL for privsep tokens", () => {
    const script = pveumEnsureServiceAccountAclScript({
      id: "homepage",
      userid: "homepage@pam",
      tokenid: "homepage",
      role: "PVEAuditor",
      password_vault_key: "A",
      token_vault_key: "B",
    });
    expect(script).toBe(
      `${pveumEnsureUserAclCommand("homepage@pam", "PVEAuditor")}; ${pveumEnsureTokenAclCommand("homepage@pam!homepage", "PVEAuditor")}`,
    );
    expect(PVE_BUILTIN_ROLES.has("PVEAuditor")).toBe(true);
  });

  it("validateServiceAccountClusterResources requires widget fields", () => {
    expect(
      validateServiceAccountClusterResources({
        data: [{ type: "node", status: "online", node: "pve-a", maxmem: 1, maxcpu: 4 }],
      }).ok,
    ).toBe(false);
    expect(
      validateServiceAccountClusterResources({
        data: [
          { type: "node", status: "online", node: "pve-a", maxmem: 1, maxcpu: 4 },
          { type: "qemu", template: 0, vmid: 100, status: "running" },
        ],
      }),
    ).toEqual({ ok: true });
    expect(
      validateServiceAccountClusterResources({
        data: [
          { type: "node", status: "online", node: "pve-a" },
          { type: "qemu", template: 0, vmid: 100, status: "running" },
        ],
      }).message,
    ).toContain("maxmem");
  });

  it("parsePveApiTokenSecret and proxmoxWidgetUsernameFromToken", () => {
    const raw = "homepage@pam!homepage=abc-secret-123";
    expect(parsePveApiTokenSecret(raw)).toBe("abc-secret-123");
    expect(proxmoxWidgetUsernameFromToken(raw)).toBe("homepage@pam!homepage");
    expect(proxmoxWidgetUsernameFromToken("PVEAPIToken=homepage@pam!homepage=abc")).toBe(
      "homepage@pam!homepage",
    );
  });

  it("proxmoxHostEnvSlug uppercases host id", () => {
    expect(proxmoxHostEnvSlug("pve-a")).toBe("PVE_A");
  });
});
