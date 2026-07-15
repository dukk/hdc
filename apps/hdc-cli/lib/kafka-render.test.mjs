import { describe, expect, it } from "vitest";
import {
  buildControllerQuorumVoters,
  renderServerProperties,
} from "hdc/clump/services/kafka/lib/kafka-render.mjs";

describe("kafka-render", () => {
  it("builds controller.quorum.voters", () => {
    const voters = buildControllerQuorumVoters(
      [
        { nodeId: 1, host: "192.0.2.21" },
        { nodeId: 2, host: "192.0.2.22" },
        { nodeId: 3, host: "192.0.2.23" },
      ],
      9093,
    );
    expect(voters).toBe("1@192.0.2.21:9093,2@192.0.2.22:9093,3@192.0.2.23:9093");
  });

  it("renders KRaft server.properties", () => {
    const props = renderServerProperties({
      nodeId: 2,
      clusterId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      advertisedHost: "192.0.2.22",
      listenerPort: 9092,
      controllerPort: 9093,
      quorumVoters: "1@192.0.2.21:9093,2@192.0.2.22:9093,3@192.0.2.23:9093",
      logDirs: ["/var/lib/kafka/data"],
    });
    expect(props).toContain("node.id=2");
    expect(props).toContain("process.roles=broker,controller");
    expect(props).toContain("cluster.id=a1b2c3d4-e5f6-7890-abcd-ef1234567890");
    expect(props).toContain("advertised.listeners=PLAINTEXT://192.0.2.22:9092");
    expect(props).toContain("controller.quorum.voters=1@192.0.2.21:9093");
    expect(props).toContain("log.dirs=/var/lib/kafka/data");
  });
});
