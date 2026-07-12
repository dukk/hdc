import { describe, expect, it } from "vitest";
import {
  hasStandbyDeployments,
  instanceFlagToSystemId,
  normalizePostgresqlConfig,
  postgresqlGlobalSettings,
  resolvePostgresqlDeployments,
} from "../../../clumps/services/postgresql/lib/deployments.mjs";

const sampleCfg = {
  schema_version: 2,
  postgresql: {
    version_major: 16,
    listen_cidrs: ["192.0.2.0/24"],
  },
  defaults: {
    mode: "configure-only",
    configure: { ssh: { user: "root", host: "192.0.2.1" } },
  },
  deployments: [
    {
      system_id: "vm-postgres-a",
      role: "primary",
      mode: "configure-only",
      configure: { ssh: { host: "192.0.2.20" } },
    },
    {
      system_id: "vm-postgres-b",
      role: "standby",
      primary_system_id: "vm-postgres-a",
      mode: "configure-only",
      configure: { ssh: { host: "192.0.2.21" } },
    },
    {
      system_id: "vm-postgres-c",
      role: "standalone",
      mode: "configure-only",
      configure: { ssh: { host: "192.0.2.22" } },
    },
  ],
};

describe("postgresql-deployments", () => {
  it("normalizes deployments with roles", () => {
    const n = normalizePostgresqlConfig(sampleCfg);
    expect(n.deployments).toHaveLength(3);
    expect(n.postgresql.version_major).toBe(16);
  });

  it("rejects standby without primary_system_id", () => {
    expect(() =>
      normalizePostgresqlConfig({
        ...sampleCfg,
        deployments: [
          { system_id: "vm-postgres-b", role: "standby", configure: { ssh: { host: "192.0.2.21" } } },
        ],
      }),
    ).toThrow(/primary_system_id/);
  });

  it("rejects invalid system_id pattern", () => {
    expect(() =>
      normalizePostgresqlConfig({
        deployments: [
          {
            system_id: "vm-postgres-1",
            role: "standalone",
            configure: { ssh: { host: "192.0.2.1" } },
          },
        ],
      }),
    ).toThrow(/vm-postgres/);
  });

  it("orders standby after primary/standalone when deploying all", () => {
    const list = resolvePostgresqlDeployments(sampleCfg, {});
    expect(list.map((d) => d.role)).toEqual(["primary", "standalone", "standby"]);
  });

  it("instanceFlagToSystemId maps letter to vm-postgres-a", () => {
    expect(instanceFlagToSystemId("a")).toBe("vm-postgres-a");
  });

  it("hasStandbyDeployments detects standby", () => {
    const all = resolvePostgresqlDeployments(sampleCfg, {});
    expect(hasStandbyDeployments(all)).toBe(true);
  });

  it("postgresqlGlobalSettings reads version and vault keys", () => {
    const g = postgresqlGlobalSettings(normalizePostgresqlConfig(sampleCfg));
    expect(g.versionMajor).toBe(16);
    expect(g.superuserVaultKey).toBe("HDC_POSTGRESQL_SUPERUSER_PASSWORD");
  });
});
