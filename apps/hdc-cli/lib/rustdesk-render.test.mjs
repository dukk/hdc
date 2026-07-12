import { describe, expect, it } from "vitest";
import {
  alwaysUseRelay,
  clientConfigSummary,
  composeDir,
  dataDir,
  normalizeImageTag,
  renderComposeYaml,
  resolveIdServerHost,
  REQUIRED_PORTS,
} from "../../../clumps/services/rustdesk/lib/rustdesk-render.mjs";

describe("rustdesk-render", () => {
  const rustdesk = {
    image_tag: "latest",
    always_use_relay: false,
    id_server_host: null,
  };
  const install = { compose_dir: "/opt/rustdesk" };

  it("normalizes image tag and paths", () => {
    expect(normalizeImageTag(rustdesk)).toBe("latest");
    expect(normalizeImageTag({})).toBe("latest");
    expect(alwaysUseRelay(rustdesk)).toBe(false);
    expect(alwaysUseRelay({ always_use_relay: true })).toBe(true);
    expect(composeDir(install)).toBe("/opt/rustdesk");
    expect(dataDir(install)).toBe("/opt/rustdesk/data");
  });

  it("renders compose with host network and both services", () => {
    const compose = renderComposeYaml(rustdesk, install);
    expect(compose).toContain("rustdesk/rustdesk-server:latest");
    expect(compose).toContain("container_name: hbbs");
    expect(compose).toContain("container_name: hbbr");
    expect(compose).toContain("network_mode: host");
    expect(compose).toContain("command: hbbs");
    expect(compose).toContain("command: hbbr");
    expect(compose).toContain("'/opt/rustdesk/data:/root'");
    expect(compose).not.toContain("ALWAYS_USE_RELAY");
  });

  it("adds ALWAYS_USE_RELAY when always_use_relay is true", () => {
    const compose = renderComposeYaml({ ...rustdesk, always_use_relay: true }, install);
    expect(compose).toContain("ALWAYS_USE_RELAY=Y");
  });

  it("resolveIdServerHost prefers id_server_host over CT IP", () => {
    expect(resolveIdServerHost("192.0.2.50", rustdesk)).toBe("192.0.2.50");
    expect(resolveIdServerHost("192.0.2.50", { id_server_host: "rustdesk.lan" })).toBe("rustdesk.lan");
    expect(resolveIdServerHost(null, rustdesk)).toBeNull();
  });

  it("clientConfigSummary includes ports and client hint", () => {
    const summary = clientConfigSummary("192.0.2.50", "abc123key", rustdesk);
    expect(summary.id_server).toBe("192.0.2.50");
    expect(summary.public_key).toBe("abc123key");
    expect(summary.relay_server).toBeNull();
    expect(summary.relay_port).toBe(REQUIRED_PORTS.relay_port);
    expect(summary.ports.tcp).toContain(21117);
    expect(summary.ports.udp).toContain(21116);
    expect(summary.client_hint).toContain("ID/Relay server");
  });
});
