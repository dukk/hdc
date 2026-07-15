import { describe, expect, it } from "vitest";
import { formatClusterCreateArgs } from "hdc/clump/services/redis/lib/redis-cluster.mjs";
import { renderRedisConf } from "hdc/clump/services/redis/lib/redis-render.mjs";

describe("redis-render", () => {
  it("includes cluster-enabled and announce IP without password", () => {
    const conf = renderRedisConf({
      announceIp: "192.0.2.30",
      port: 6379,
      maxmemory: "512mb",
      maxmemoryPolicy: "allkeys-lru",
    });
    expect(conf).toContain("cluster-enabled yes");
    expect(conf).toContain("cluster-announce-ip 192.0.2.30");
    expect(conf).toContain("cluster-announce-port 6379");
    expect(conf).toContain("cluster-announce-bus-port 16379");
    expect(conf).not.toContain("requirepass");
    expect(conf).not.toContain("masterauth");
  });

  it("includes requirepass when password provided", () => {
    const conf = renderRedisConf({
      announceIp: "192.0.2.30",
      password: "s3cret",
    });
    expect(conf).toContain("requirepass s3cret");
    expect(conf).toContain("masterauth s3cret");
  });
});

describe("redis-cluster helpers", () => {
  it("formatClusterCreateArgs joins endpoints", () => {
    const args = formatClusterCreateArgs([
      { host: "192.0.2.30", port: 6379 },
      { host: "192.0.2.31", port: 6379 },
    ]);
    expect(args).toBe("192.0.2.30:6379 192.0.2.31:6379");
  });
});
