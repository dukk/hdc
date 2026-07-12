import { describe, expect, it } from "vitest";
import {
  buildRustfsVolumesEnv,
  composeDir,
  dataDir,
  renderComposeYaml,
  renderEnvFile,
  resolveS3UpstreamPool,
  resolveS3UpstreamUrl,
  s3Port,
} from "../../../clumps/services/rustfs/lib/rustfs-render.mjs";

describe("rustfs-render", () => {
  const rustfs = {
    image: "rustfs/rustfs:latest",
    s3_port: 9000,
    console_port: 9001,
    drives_per_node: 4,
    data_path_prefix: "/data/rustfs",
    unsafe_bypass_disk_check: false,
  };
  const install = { compose_dir: "/opt/rustfs" };

  const peers = [
    { hostname: "rustfs-a" },
    { hostname: "rustfs-b" },
    { hostname: "rustfs-c" },
    { hostname: "rustfs-d" },
  ];

  it("normalizes port and paths", () => {
    expect(s3Port(rustfs)).toBe(9000);
    expect(s3Port({})).toBe(9000);
    expect(composeDir(install)).toBe("/opt/rustfs");
    expect(dataDir(install)).toBe("/opt/rustfs/data");
  });

  it("builds RUSTFS_VOLUMES for four peers", () => {
    const volumes = buildRustfsVolumesEnv(peers, rustfs);
    expect(volumes).toBe(
      "http://rustfs-a:9000/data/rustfs{1...4},http://rustfs-b:9000/data/rustfs{1...4},http://rustfs-c:9000/data/rustfs{1...4},http://rustfs-d:9000/data/rustfs{1...4}",
    );
  });

  it("renders compose with four data volumes and healthcheck", () => {
    const compose = renderComposeYaml(rustfs);
    expect(compose).toContain("rustfs-server");
    expect(compose).toContain("rustfs/rustfs:latest");
    expect(compose).toContain("./data/rustfs1:/data/rustfs1");
    expect(compose).toContain("./data/rustfs4:/data/rustfs4");
    expect(compose).toContain("/health");
  });

  it("renders env with volumes and credentials", () => {
    const volumes = buildRustfsVolumesEnv(peers, rustfs);
    const env = renderEnvFile(rustfs, volumes, "access-key", "secret-key");
    expect(env).toContain("RUSTFS_ACCESS_KEY=access-key");
    expect(env).toContain("RUSTFS_SECRET_KEY=secret-key");
    expect(env).toContain("RUSTFS_VOLUMES=");
    expect(env).toContain("rustfs-a:9000/data/rustfs{1...4}");
    expect(env).toContain("RUSTFS_UNSAFE_BYPASS_DISK_CHECK=false");
  });

  it("resolves upstream URLs for nginx-waf", () => {
    expect(resolveS3UpstreamUrl("192.0.2.10", rustfs)).toBe("http://192.0.2.10:9000");
    expect(
      resolveS3UpstreamPool(
        [{ ctIp: "192.0.2.10" }, { ctIp: "192.0.2.11" }, { ctIp: null }],
        rustfs,
      ),
    ).toEqual(["http://192.0.2.10:9000", "http://192.0.2.11:9000"]);
  });
});
