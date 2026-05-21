import { describe, expect, it } from "vitest";
import {
  HDC_TLS_INSECURE_ENV,
  hdcTlsInsecureSourceEnv,
  hdcTlsRejectUnauthorized,
} from "./tls-insecure-env.mjs";

const SPEC = "HDC_PROXMOX_TLS_INSECURE";

describe("tls-insecure-env", () => {
  it("specific =1 disables verification regardless of global", () => {
    const env = { [SPEC]: "1", [HDC_TLS_INSECURE_ENV]: "0" };
    expect(hdcTlsInsecureSourceEnv(env, SPEC)).toBe(SPEC);
    expect(hdcTlsRejectUnauthorized(env, SPEC)).toBe(false);
  });

  it("specific non-1 value forces verification", () => {
    const env = { [SPEC]: "0", [HDC_TLS_INSECURE_ENV]: "1" };
    expect(hdcTlsInsecureSourceEnv(env, SPEC)).toBe(null);
    expect(hdcTlsRejectUnauthorized(env, SPEC)).toBe(true);
  });

  it("empty specific falls back to global", () => {
    const env = { [SPEC]: "", [HDC_TLS_INSECURE_ENV]: "1" };
    expect(hdcTlsInsecureSourceEnv(env, SPEC)).toBe(HDC_TLS_INSECURE_ENV);
    expect(hdcTlsRejectUnauthorized(env, SPEC)).toBe(false);
  });

  it("unset specific falls back to global", () => {
    const env = { [HDC_TLS_INSECURE_ENV]: "1" };
    expect(hdcTlsInsecureSourceEnv(env, SPEC)).toBe(HDC_TLS_INSECURE_ENV);
    expect(hdcTlsRejectUnauthorized(env, SPEC)).toBe(false);
  });

  it("neither set keeps verification on", () => {
    const env = {};
    expect(hdcTlsInsecureSourceEnv(env, SPEC)).toBe(null);
    expect(hdcTlsRejectUnauthorized(env, SPEC)).toBe(true);
  });
});
