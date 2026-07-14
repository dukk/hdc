import { describe, expect, it } from "vitest";

import {
  resolveOidcConfig,
  createOidcLoginState,
  encodeOidcStateCookie,
  decodeOidcStateCookie,
  buildAuthorizeUrl,
  usernameFromUserinfo,
  oidcStatesMatch,
  clearOidcDiscoveryCache,
  fetchOidcDiscovery,
} from "./oidc.mjs";

describe("resolveOidcConfig", () => {
  it("derives redirect URI from public URL", () => {
    const cfg = resolveOidcConfig({
      HDC_WEB_OIDC_ISSUER: "https://keycloak.example/realms/dukk-sso/",
      HDC_WEB_OIDC_CLIENT_ID: "hdc-web",
      HDC_WEB_OIDC_CLIENT_SECRET: "sekrit",
      HDC_WEB_PUBLIC_URL: "https://hdc.example/",
    });
    expect(cfg.configured).toBe(true);
    expect(cfg.issuer).toBe("https://keycloak.example/realms/dukk-sso");
    expect(cfg.redirectUri).toBe("https://hdc.example/api/auth/oidc/callback");
  });

  it("is not configured when secret missing", () => {
    const cfg = resolveOidcConfig({
      HDC_WEB_OIDC_ISSUER: "https://keycloak.example/realms/dukk-sso",
      HDC_WEB_OIDC_CLIENT_ID: "hdc-web",
      HDC_WEB_PUBLIC_URL: "https://hdc.example",
    });
    expect(cfg.configured).toBe(false);
  });
});

describe("OIDC state cookie", () => {
  it("round-trips signed state", () => {
    const login = createOidcLoginState();
    const cookie = encodeOidcStateCookie(
      { state: login.state, codeVerifier: login.codeVerifier },
      "session-secret",
    );
    const decoded = decodeOidcStateCookie(cookie, "session-secret");
    expect(decoded).toEqual({
      state: login.state,
      codeVerifier: login.codeVerifier,
    });
    expect(oidcStatesMatch(login.state, decoded.state)).toBe(true);
  });

  it("rejects tampered cookie", () => {
    const login = createOidcLoginState();
    const cookie = encodeOidcStateCookie(
      { state: login.state, codeVerifier: login.codeVerifier },
      "session-secret",
    );
    expect(decodeOidcStateCookie(`${cookie}x`, "session-secret")).toBeNull();
    expect(decodeOidcStateCookie(cookie, "other-secret")).toBeNull();
  });
});

describe("buildAuthorizeUrl", () => {
  it("includes PKCE params", () => {
    const url = buildAuthorizeUrl({
      authorizationEndpoint: "https://keycloak.example/realms/r/protocol/openid-connect/auth",
      clientId: "hdc-web",
      redirectUri: "https://hdc.example/api/auth/oidc/callback",
      state: "abc",
      codeChallenge: "challenge",
    });
    const u = new URL(url);
    expect(u.searchParams.get("client_id")).toBe("hdc-web");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("scope")).toContain("openid");
  });
});

describe("usernameFromUserinfo", () => {
  it("prefers preferred_username", () => {
    expect(
      usernameFromUserinfo({
        preferred_username: "alice",
        email: "alice@example.invalid",
        sub: "uuid",
      }),
    ).toBe("alice");
  });

  it("falls back to email then sub", () => {
    expect(usernameFromUserinfo({ email: "a@b.c", sub: "uuid" })).toBe("a@b.c");
    expect(usernameFromUserinfo({ sub: "uuid" })).toBe("uuid");
  });
});

describe("fetchOidcDiscovery", () => {
  it("caches discovery document", async () => {
    clearOidcDiscoveryCache();
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            authorization_endpoint: "https://kc/auth",
            token_endpoint: "https://kc/token",
            userinfo_endpoint: "https://kc/userinfo",
            end_session_endpoint: "https://kc/logout",
          }),
      };
    };
    const a = await fetchOidcDiscovery("https://kc/realms/r", { fetchImpl });
    const b = await fetchOidcDiscovery("https://kc/realms/r", { fetchImpl });
    expect(calls).toBe(1);
    expect(a.authorization_endpoint).toBe("https://kc/auth");
    expect(b.end_session_endpoint).toBe("https://kc/logout");
  });
});
