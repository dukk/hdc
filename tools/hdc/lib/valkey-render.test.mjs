import { describe, expect, it } from "vitest";
import { formatClusterCreateArgs } from "../../../packages/services/valkey/lib/valkey-cluster.mjs";
import { renderValkeyConf } from "../../../packages/services/valkey/lib/valkey-render.mjs";

describe("valkey-render", () => {
  it("includes cluster-enabled and announce IP without password", () => {
    const conf = renderValkeyConf({
      announceIp: "192.0.2.33",
      port: 6379,
      maxmemory: "512mb",
      maxmemoryPolicy: "allkeys-lru",
    });
    expect(conf).toContain("cluster-enabled yes");
    expect(conf).toContain("cluster-announce-ip 192.0.2.33");
    expect(conf).toContain("cluster-announce-port 6379");
    expect(conf).toContain("cluster-announce-bus-port 16379");
    expect(conf).not.toContain("requirepass");
    expect(conf).not.toContain("masterauth");
  });

  it("includes requirepass when password provided", () => {
    const conf = renderValkeyConf({
      announceIp: "192.0.2.33",
      password: "s3cret",
    });
    expect(conf).toContain("requirepass s3cret");
    expect(conf).toContain("masterauth s3cret");
  });
});

describe("valkey-cluster helpers", () => {
  it("formatClusterCreateArgs joins endpoints", () => {
    const args = formatClusterCreateArgs([
      { host: "192.0.2.33", port: 6379 },
      { host: "192.0.2.34", port: 6379 },
    ]);
    expect(args).toBe("192.0.2.33:6379 192.0.2.34:6379");
  });
});
