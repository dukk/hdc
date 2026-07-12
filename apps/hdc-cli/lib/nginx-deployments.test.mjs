import { describe, expect, it } from "vitest";
import {
  instanceFlagToSystemId,
  nginxGlobalSettings,
  normalizeNginxConfig,
  resolveNginxDeployments,
} from "../../../clumps/services/nginx/lib/deployments.mjs";

const sampleCfg = {
  schema_version: 2,
  letsencrypt: {
    challenge: "http-01",
    email_vault_key: "HDC_NGINX_LE_EMAIL",
  },
  sites: [
    {
      id: "example-app",
      server_names: ["app.hdc.example.invalid"],
      upstream: "http://192.0.2.50:8080",
      tls: { enabled: true, cert_name: "app.hdc.example.invalid" },
    },
  ],
  defaults: {
    mode: "configure-only",
    proxmox: { qemu: { template_vmid: 9024 } },
  },
  deployments: [
    {
      system_id: "vm-nginx-a",
      configure: { ssh: { host: "192.0.2.30" } },
    },
    {
      system_id: "vm-nginx-b",
      configure: { ssh: { host: "192.0.2.31" } },
    },
  ],
};

describe("nginx deployments", () => {
  it("normalizes deployments[] with defaults merge", () => {
    const { deployments } = normalizeNginxConfig(sampleCfg);
    expect(deployments).toHaveLength(2);
    expect(deployments[0].system_id).toBe("vm-nginx-a");
    expect(deployments[0].mode).toBe("configure-only");
  });

  it("rejects duplicate system_id", () => {
    expect(() =>
      normalizeNginxConfig({
        schema_version: 2,
        deployments: [
          { system_id: "vm-nginx-a" },
          { system_id: "vm-nginx-a" },
        ],
      }),
    ).toThrow(/duplicate system_id/);
  });

  it("rejects invalid system_id pattern", () => {
    expect(() =>
      normalizeNginxConfig({
        schema_version: 2,
        deployments: [{ system_id: "vm-web-a" }],
      }),
    ).toThrow(/vm-nginx/);
  });

  it("maps --instance a to vm-nginx-a", () => {
    expect(instanceFlagToSystemId("a")).toBe("vm-nginx-a");
  });

  it("resolves single deployment when --instance set", () => {
    const selected = resolveNginxDeployments(sampleCfg, { instance: "b" });
    expect(selected).toHaveLength(1);
    expect(selected[0].systemId).toBe("vm-nginx-b");
  });

  it("returns all deployments when no filter and multiple configured", () => {
    const all = resolveNginxDeployments(sampleCfg, {});
    expect(all).toHaveLength(2);
  });

  it("nginxGlobalSettings uses HDC_NGINX_LE_EMAIL vault key", () => {
    const normalized = normalizeNginxConfig(sampleCfg);
    const global = nginxGlobalSettings(normalized);
    expect(global.emailVaultKey).toBe("HDC_NGINX_LE_EMAIL");
    expect(global.challenge).toBe("http-01");
    expect(global.clientMaxBodySize).toBe("64m");
  });
});
