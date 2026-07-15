import { describe, expect, it } from "vitest";

import {
  parseLocalApiPort,
  rewriteLocalApiPort,
  resolveSshCommand,
} from "hdc/clump/services/uptime-kuma/lib/uptime-kuma-ssh-tunnel.mjs";

describe("uptime-kuma-ssh-tunnel", () => {
  it("parseLocalApiPort reads localhost ports", () => {
    expect(parseLocalApiPort("http://127.0.0.1:3001")).toBe(3001);
    expect(parseLocalApiPort("http://localhost:3001/")).toBe(3001);
    expect(parseLocalApiPort("http://192.0.2.1:3001")).toBeNull();
  });

  it("rewriteLocalApiPort updates localhost port", () => {
    expect(rewriteLocalApiPort("http://127.0.0.1:3001", 3010)).toBe("http://127.0.0.1:3010");
    expect(rewriteLocalApiPort("http://192.0.2.1:3001", 3010)).toBe("http://192.0.2.1:3001");
  });

  it("resolveSshCommand returns a non-empty ssh command", () => {
    expect(resolveSshCommand()).toMatch(/ssh/);
  });
});
