import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  hashMcpApiKey,
  mintMcpApiKeySecret,
  mcpApiKeyRequired,
  mcpApiKeyVaultKey,
  registerMcpApiKeyHash,
  resolveMcpApiKey,
  resolveMcpAuth,
  scopesFromRole,
} from "./api-keys.mjs";

/** @type {string[]} */
const dirs = [];

afterEach(() => {
  while (dirs.length) {
    const d = dirs.pop();
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

function tmpPrivate() {
  const d = mkdtempSync(path.join(tmpdir(), "hdc-mcp-keys-"));
  dirs.push(d);
  return d;
}

describe("hdc-mcp-server api-keys", () => {
  it("names vault keys from roles", () => {
    expect(mcpApiKeyVaultKey("hdc-manager")).toBe("HDC_MCP_API_KEY_HDC_MANAGER");
    expect(mcpApiKeyVaultKey("hdc-scheduler")).toBe("HDC_MCP_API_KEY_HDC_SCHEDULER");
  });

  it("mints hdcmcp_ secrets and hashes stably", () => {
    const secret = mintMcpApiKeySecret();
    expect(secret.startsWith("hdcmcp_")).toBe(true);
    expect(hashMcpApiKey(secret)).toBe(hashMcpApiKey(secret));
    expect(hashMcpApiKey(secret)).not.toBe(hashMcpApiKey(`${secret}x`));
  });

  it("registers and resolves keys with role scopes", () => {
    const root = tmpPrivate();
    const secret = mintMcpApiKeySecret();
    registerMcpApiKeyHash(root, { role: "hdc-monitor", secret });
    const hit = resolveMcpApiKey(secret, root);
    expect(hit?.role).toBe("hdc-monitor");
    expect(hit?.policy.runVerbs.has("maintain")).toBe(false);
    expect(scopesFromRole("hdc-monitor").tools).toContain("hdc_run");
  });

  it("rejects wrong keys", () => {
    const root = tmpPrivate();
    registerMcpApiKeyHash(root, { role: "hdc-sre-ops", secret: mintMcpApiKeySecret() });
    expect(resolveMcpApiKey(mintMcpApiKeySecret(), root)).toBeNull();
  });

  it("prefer api key over HDC_AGENT_ROLE and require when configured", () => {
    const root = tmpPrivate();
    const secret = mintMcpApiKeySecret();
    registerMcpApiKeyHash(root, { role: "hdc-sre-engineer", secret });
    const auth = resolveMcpAuth({
      env: { HDC_AGENT_ROLE: "hdc-manager", HDC_MCP_API_KEY: secret },
      privateRoot: root,
    });
    expect(auth).toEqual({ role: "hdc-sre-engineer", via: "api_key" });

    expect(mcpApiKeyRequired({ HDC_MCP_REQUIRE_API_KEY: "1" })).toBe(true);
    expect(() =>
      resolveMcpAuth({ env: { HDC_MCP_REQUIRE_API_KEY: "1" }, privateRoot: root }),
    ).toThrow(/required/);
  });

  it("falls back to env role when key not required", () => {
    const auth = resolveMcpAuth({
      env: { HDC_AGENT_ROLE: "hdc-monitor" },
      privateRoot: tmpPrivate(),
      resolveRole: (e) => String(e.HDC_AGENT_ROLE || "default"),
    });
    expect(auth).toEqual({ role: "hdc-monitor", via: "env_role" });
  });
});
