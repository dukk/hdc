import { describe, expect, it } from "vitest";
import {
  gatusListenPort,
  renderGatusConfigYaml,
} from "../../../clumps/services/gatus/lib/gatus-render.mjs";

describe("gatus render", () => {
  it("renders endpoints with conditions", () => {
    const yaml = renderGatusConfigYaml({
      endpoints: [
        {
          name: "website",
          group: "core",
          url: "https://example.com",
          interval: "5m",
          conditions: ["[STATUS] == 200"],
        },
      ],
    });
    expect(yaml).toContain("endpoints:");
    expect(yaml).toContain("name: website");
    expect(yaml).toContain('url: "https://example.com"');
    expect(yaml).toContain("[STATUS] == 200");
  });

  it("renders empty endpoints", () => {
    expect(renderGatusConfigYaml({ endpoints: [] })).toBe("endpoints: []\n");
  });

  it("appends config_yaml_extra", () => {
    const yaml = renderGatusConfigYaml({
      endpoints: [],
      config_yaml_extra: "storage:\n  type: sqlite",
    });
    expect(yaml).toContain("endpoints: []");
    expect(yaml).toContain("storage:");
  });

  it("gatusListenPort defaults to 8080", () => {
    expect(gatusListenPort({})).toBe(8080);
    expect(gatusListenPort({ listen_port: 9000 })).toBe(9000);
  });
});
