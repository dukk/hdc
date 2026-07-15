import { describe, expect, it } from "vitest";
import {
  allowNewAccounts,
  composeDir,
  DEFAULT_TRUSTED_PROXIES,
  MESHCENTRAL_HTTP_PORT,
  mongoPasswordVaultKey,
  mongoUrl,
  normalizeImageTag,
  renderComposeYaml,
  renderMeshcentralEnv,
  resolveHostname,
  resolvePublicUrl,
  serviceSummary,
  trustedProxies,
} from "hdc/clump/services/meshcentral/lib/meshcentral-render.mjs";

describe("meshcentral-render", () => {
  const meshcentral = {
    image_tag: "latest",
    public_url: "https://meshcentral.example.invalid",
    trusted_proxies: ["192.0.2.40", "192.0.2.41"],
    allow_new_accounts: false,
  };
  const install = { compose_dir: "/opt/meshcentral" };

  it("normalizes image tag and paths", () => {
    expect(normalizeImageTag(meshcentral)).toBe("latest");
    expect(normalizeImageTag({})).toBe("latest");
    expect(composeDir(install)).toBe("/opt/meshcentral");
    expect(mongoPasswordVaultKey({})).toBe("HDC_MESHCENTRAL_MONGO_PASSWORD");
  });

  it("resolves hostname and public URL", () => {
    expect(resolvePublicUrl(meshcentral)).toBe("https://meshcentral.example.invalid");
    expect(resolveHostname(meshcentral)).toBe("meshcentral.example.invalid");
    expect(resolveHostname({ hostname: "mc.lan" })).toBe("mc.lan");
    expect(trustedProxies(meshcentral)).toEqual(["192.0.2.40", "192.0.2.41"]);
    expect(trustedProxies({})).toEqual(DEFAULT_TRUSTED_PROXIES);
    expect(allowNewAccounts(meshcentral)).toBe(false);
    expect(allowNewAccounts({ allow_new_accounts: true })).toBe(true);
  });

  it("renders compose with mongodb and meshcentral services", () => {
    const compose = renderComposeYaml(meshcentral);
    expect(compose).toContain("ghcr.io/ylianst/meshcentral:latest");
    expect(compose).toContain("image: mongo:7");
    expect(compose).toContain(`"${MESHCENTRAL_HTTP_PORT}:${MESHCENTRAL_HTTP_PORT}"`);
    expect(compose).toContain("meshcentral-data:");
    expect(compose).toContain("mongodb-data:");
  });

  it("renders env with TLS offload and Mongo URL", () => {
    const env = renderMeshcentralEnv(meshcentral, "secret-pass");
    expect(env).toContain("DYNAMIC_CONFIG=true");
    expect(env).toContain("TLS_OFFLOAD=true");
    expect(env).toContain("REDIR_PORT=0");
    expect(env).toContain(`PORT=${MESHCENTRAL_HTTP_PORT}`);
    expect(env).toContain("HOSTNAME=meshcentral.example.invalid");
    expect(env).toContain("REVERSE_PROXY=meshcentral.example.invalid");
    expect(env).toContain("USE_MONGODB=true");
    expect(env).toContain("MONGO_INITDB_ROOT_PASSWORD=secret-pass");
    expect(env).toContain("TRUSTED_PROXY=true");
    expect(mongoUrl(meshcentral, "secret-pass")).toContain(
      "mongodb://meshcentral:secret-pass@mongodb:27017/meshcentral",
    );
  });

  it("serviceSummary includes agent hint", () => {
    const summary = serviceSummary("192.0.2.207", meshcentral);
    expect(summary.ct_ip).toBe("192.0.2.207");
    expect(summary.public_url).toBe("https://meshcentral.example.invalid");
    expect(summary.agent_hint).toContain("https://meshcentral.example.invalid");
  });
});
