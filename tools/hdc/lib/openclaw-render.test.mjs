import { describe, expect, it } from "vitest";
import {
  gatewayBind,
  gatewayPort,
  renderOpenclawConfigObject,
  renderOpenclawEnvFile,
  renderOpenclawJson,
  resolveDashboardUrl,
} from "../../../packages/services/openclaw/lib/openclaw-render.mjs";

describe("openclaw render", () => {
  const openclaw = {
    gateway: { bind: "loopback", port: 18789 },
    agents: {
      defaults: {
        model: { primary: "anthropic/claude-sonnet-4-6" },
      },
    },
    channels: {
      telegram: { enabled: true, botToken: "${TELEGRAM_BOT_TOKEN}" },
    },
  };

  it("renders gateway loopback with env token substitution", () => {
    const doc = renderOpenclawConfigObject(openclaw);
    expect(doc.gateway).toMatchObject({
      mode: "local",
      bind: "loopback",
      port: 18789,
      auth: { token: "${OPENCLAW_GATEWAY_TOKEN}" },
    });
    const json = renderOpenclawJson(openclaw);
    expect(json).toContain("${OPENCLAW_GATEWAY_TOKEN}");
    expect(json).toContain("anthropic/claude-sonnet-4-6");
  });

  it("defaults bind to loopback and port 18789", () => {
    expect(gatewayBind({})).toBe("loopback");
    expect(gatewayPort({})).toBe(18789);
    expect(gatewayBind({ gateway: { bind: "lan" } })).toBe("lan");
  });

  it("renders env file with quoted values", () => {
    const env = renderOpenclawEnvFile({
      OPENCLAW_GATEWAY_TOKEN: "tok",
      ANTHROPIC_API_KEY: "sk-test",
    });
    expect(env).toContain('OPENCLAW_GATEWAY_TOKEN="tok"');
    expect(env).toContain('ANTHROPIC_API_KEY="sk-test"');
  });

  it("resolveDashboardUrl documents SSH tunnel for loopback", () => {
    const u = resolveDashboardUrl({ gateway: { bind: "loopback", port: 18789 } }, "192.0.2.99");
    expect(u.gateway_url).toBe("http://127.0.0.1:18789");
    expect(u.access_note).toContain("ssh -L 18789:127.0.0.1:18789");
    expect(u.access_note).toContain("192.0.2.99");
  });
});
