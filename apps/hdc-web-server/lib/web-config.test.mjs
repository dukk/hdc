import { describe, expect, it } from "vitest";

import {
  DEFAULT_AUTH_MODE,
  normalizeAuthMode,
  passwordLoginEnabledForMode,
  resolveAuthConfig,
} from "./web-config.mjs";

describe("web-config auth modes", () => {
  it("defaults to both", () => {
    expect(DEFAULT_AUTH_MODE).toBe("both");
    expect(normalizeAuthMode(undefined)).toBe("both");
    expect(normalizeAuthMode("")).toBe("both");
    expect(normalizeAuthMode("invalid")).toBe("both");
  });

  it("normalizes known modes", () => {
    expect(normalizeAuthMode("both")).toBe("both");
    expect(normalizeAuthMode("htpasswd")).toBe("htpasswd");
    expect(normalizeAuthMode("oidc")).toBe("oidc");
    expect(normalizeAuthMode("  oidc  ")).toBe("oidc");
  });

  it("enables password for both and htpasswd", () => {
    expect(passwordLoginEnabledForMode("both")).toBe(true);
    expect(passwordLoginEnabledForMode("htpasswd")).toBe(true);
    expect(passwordLoginEnabledForMode("oidc")).toBe(false);
  });

  it("resolveAuthConfig reads auth block with default mode", () => {
    expect(resolveAuthConfig({})).toEqual({
      mode: "both",
      htpasswdFile: ".htpasswd.enc",
      adminUsername: "admin",
    });
  });

  it("resolveAuthConfig honors explicit oidc mode", () => {
    expect(
      resolveAuthConfig({
        auth: {
          mode: "oidc",
          htpasswd_file: "custom.enc",
          admin_username: "ops",
        },
      }),
    ).toEqual({
      mode: "oidc",
      htpasswdFile: "custom.enc",
      adminUsername: "ops",
    });
  });
});
