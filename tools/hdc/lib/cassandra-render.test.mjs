import { describe, expect, it } from "vitest";
import {
  jvmHeapMb,
  renderCassandraYaml,
  renderJvmOptions,
  renderRackDcProperties,
} from "../../../packages/services/cassandra/lib/cassandra-render.mjs";

describe("cassandra-render", () => {
  it("renderCassandraYaml includes cluster and seeds", () => {
    const yaml = renderCassandraYaml({
      clusterName: "hdc-cassandra",
      seedIps: ["192.0.2.20", "192.0.2.21"],
      listenAddress: "192.0.2.20",
      passwordAuthEnabled: true,
    });
    expect(yaml).toContain("cluster_name: 'hdc-cassandra'");
    expect(yaml).toContain("192.0.2.20,192.0.2.21");
    expect(yaml).toContain("PasswordAuthenticator");
    expect(yaml).toContain("listen_address: 192.0.2.20");
  });

  it("renderRackDcProperties sets dc and rack", () => {
    const props = renderRackDcProperties({ datacenter: "hdc", rack: "rack1" });
    expect(props).toContain("dc=hdc");
    expect(props).toContain("rack=rack1");
  });

  it("jvmHeapMb caps heap sensibly", () => {
    expect(jvmHeapMb(8192)).toBe(4096);
    expect(jvmHeapMb(4096)).toBe(2048);
    expect(jvmHeapMb(32768)).toBe(8192);
  });

  it("renderJvmOptions includes heap flags", () => {
    const jvm = renderJvmOptions({ memoryMb: 8192 });
    expect(jvm).toContain("-Xms4096m");
    expect(jvm).toContain("-Xmx4096m");
  });
});
