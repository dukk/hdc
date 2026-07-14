import { describe, expect, it } from "vitest";

import { enabledAgents, litellmA2aAgentEntries, renderComposeYaml, renderDockerfile } from "./hdc-agents-render.mjs";

describe("hdc-agents-render", () => {
  it("defaults to full roster when agents empty", () => {
    expect(enabledAgents({}).length).toBe(8);
    expect(enabledAgents({ agents: [] }).length).toBe(8);
  });

  it("renders compose with manager on 9200", () => {
    const yaml = renderComposeYaml(
      { litellm_base_url: "http://192.0.2.116:4000" },
      { compose_dir: "/opt/hdc-agents" },
    );
    expect(yaml).toContain("HDC_AGENT_ROLE: hdc-manager");
    expect(yaml).toContain('"9200:9200/tcp"');
    expect(yaml).toContain("hdc-engineer");
  });

  it("builds litellm a2a entries from guest ip", () => {
    const entries = litellmA2aAgentEntries("192.0.2.117", {});
    expect(entries[0]).toMatchObject({
      name: "hdc-manager",
      url: "http://192.0.2.117:9200",
      protocol_version: "0.3",
    });
  });

  it("renders dockerfile with agent-server cmd", () => {
    expect(renderDockerfile({})).toContain("apps/hdc-agent-server/server.mjs");
  });
});
