import { describe, expect, it } from "vitest";

import {
  createSessionToken,
  verifySessionToken,
  validateLogin,
  verifyBearerToken,
  resolveAuthUser,
  sessionSetCookieHeader,
} from "./hdc-runner-ui-auth.mjs";
import { validatePackagePolicy, validateSchedulePolicy } from "./hdc-runner-ui-policy.mjs";

describe("hdc-runner-ui-auth", () => {
  const secret = "test-session-secret-value-32chars!!";

  it("creates and verifies session token", () => {
    const token = createSessionToken("hdc", secret);
    expect(verifySessionToken(token, secret)).toBe("hdc");
    expect(verifySessionToken(token, "wrong")).toBeNull();
    expect(verifySessionToken("bad.token", secret)).toBeNull();
  });

  it("validateLogin uses timing-safe compare semantics", () => {
    expect(validateLogin("hdc", "pass", "hdc", "pass")).toBe(true);
    expect(validateLogin("hdc", "wrong", "hdc", "pass")).toBe(false);
    expect(validateLogin("other", "pass", "hdc", "pass")).toBe(false);
  });

  it("sessionSetCookieHeader includes HttpOnly", () => {
    const hdr = sessionSetCookieHeader("abc");
    expect(hdr).toContain("HttpOnly");
    expect(hdr).toContain("hdc_runner_session=");
  });

  it("verifyBearerToken accepts valid Bearer header", () => {
    const token = "agent-secret-token-value";
    expect(verifyBearerToken(`Bearer ${token}`, token)).toBe(true);
    expect(verifyBearerToken(`bearer ${token}`, token)).toBe(true);
    expect(verifyBearerToken("Basic abc", token)).toBe(false);
    expect(verifyBearerToken(`Bearer ${token}`, "other")).toBe(false);
    expect(verifyBearerToken(undefined, token)).toBe(false);
  });

  it("resolveAuthUser prefers bearer over missing cookie", () => {
    const token = "api-token-secret";
    /** @type {import("node:http").IncomingMessage} */
    const req = { headers: { authorization: `Bearer ${token}` } };
    expect(resolveAuthUser(req, "session-secret", token)).toBe("api-token");
  });
});

describe("hdc-runner-ui-policy", () => {
  it("validatePackagePolicy allows all when list empty", () => {
    expect(validatePackagePolicy({}, "service", "bind").ok).toBe(true);
  });

  it("validatePackagePolicy enforces allowlist", () => {
    const cfg = { allowed_packages: ["service/uptime-kuma"] };
    expect(validatePackagePolicy(cfg, "service", "uptime-kuma").ok).toBe(true);
    expect(validatePackagePolicy(cfg, "service", "bind").ok).toBe(false);
  });

  it("validateSchedulePolicy enforces allowlist", () => {
    const cfg = { allowed_schedule_ids: ["monitor-uptime-kuma"] };
    expect(validateSchedulePolicy(cfg, "monitor-uptime-kuma").ok).toBe(true);
    expect(validateSchedulePolicy(cfg, "daily-digest").ok).toBe(false);
  });
});
