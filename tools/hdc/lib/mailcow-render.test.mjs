import { describe, expect, it } from "vitest";

import {
  buildGenerateConfigEnv,
  buildInstallScript,
  normalizeDomainList,
  normalizeHostname,
  shellExportEnv,
} from "../../../packages/services/mailcow/lib/mailcow-render.mjs";
import { normalizeMailcowConfig } from "../../../packages/services/mailcow/lib/deployments.mjs";

describe("mailcow-render", () => {
  it("normalizeHostname requires FQDN", () => {
    expect(() => normalizeHostname({})).toThrow(/hostname/);
    expect(normalizeHostname({ hostname: "mail.example.invalid" })).toBe("mail.example.invalid");
    expect(() => normalizeHostname({ hostname: "mail" })).toThrow(/FQDN/);
  });

  it("buildGenerateConfigEnv sets mailcow env and skip flags", () => {
    const env = buildGenerateConfigEnv(
      { hostname: "mail.example.invalid", timezone: "UTC", skip_clamd: true, skip_solr: true },
      { dbpass: "db", dbroot: "root", redispass: "redis" },
    );
    expect(env.MAILCOW_HOSTNAME).toBe("mail.example.invalid");
    expect(env.MAILCOW_DBPASS).toBe("db");
    expect(env.SKIP_CLAMD).toBe("y");
    expect(env.SKIP_SOLR).toBe("y");
  });

  it("shellExportEnv quotes values", () => {
    const s = shellExportEnv({ MAILCOW_HOSTNAME: "mail.example.invalid" });
    expect(s).toContain('export MAILCOW_HOSTNAME="mail.example.invalid"');
  });

  it("buildInstallScript clones mailcow-dockerized", () => {
    const script = buildInstallScript("/opt/mailcow-dockerized", "master", {
      MAILCOW_HOSTNAME: "mail.example.invalid",
      MAILCOW_TZ: "UTC",
      MAILCOW_DBPASS: "x",
      MAILCOW_DBROOT: "y",
      MAILCOW_REDISPASS: "z",
    });
    expect(script).toContain("mailcow/mailcow-dockerized");
    expect(script).toContain("generate_config.sh");
    expect(script).toContain("docker compose up -d");
  });

  it("normalizeDomainList parses outbound mode", () => {
    const domains = normalizeDomainList({
      domains: [
        { name: "a.invalid", outbound: { mode: "postfix-relay" } },
        { name: "b.invalid", outbound: { mode: "direct" } },
        { name: "c.invalid" },
      ],
    });
    expect(domains).toHaveLength(3);
    expect(domains[0].outbound_mode).toBe("postfix-relay");
    expect(domains[1].outbound_mode).toBe("direct");
    expect(domains[2].outbound_mode).toBe("direct");
  });
});

describe("mailcow deployments config", () => {
  it("normalizeMailcowConfig validates example shape", () => {
    const cfg = {
      schema_version: 2,
      defaults: {
        mode: "proxmox-lxc",
        mailcow: { hostname: "mail.example.invalid" },
        proxmox: { lxc: { vmid: 1, memory_mb: 1024, cores: 1, rootfs_gb: 10 } },
      },
      deployments: [
        {
          system_id: "mailcow-a",
          proxmox: { host_id: "pve-a", lxc: { vmid: 490 } },
        },
      ],
    };
    const norm = normalizeMailcowConfig(cfg);
    expect(norm.deployments).toHaveLength(1);
    expect(norm.deployments[0].system_id).toBe("mailcow-a");
  });
});
