import { describe, expect, it } from "vitest";
import {
  renderHdcPgHbaConf,
  renderHdcPostgresqlConf,
  replicationHbaLine,
} from "hdc/clump/services/postgresql/lib/postgresql-render.mjs";

describe("postgresql-render", () => {
  it("renders replication settings when enabled", () => {
    const body = renderHdcPostgresqlConf({ listenAddresses: "*", replicationEnabled: true });
    expect(body).toContain("wal_level = replica");
    expect(body).toContain("listen_addresses");
  });

  it("renders hba with listen cidrs and replication lines", () => {
    const body = renderHdcPgHbaConf(
      ["192.0.2.0/24"],
      [replicationHbaLine("replicator", "192.0.2.21")],
    );
    expect(body).not.toContain("local all all peer");
    expect(body).toContain("host all all 192.0.2.0/24");
    expect(body).toContain("host replication replicator 192.0.2.21/32");
  });
});
