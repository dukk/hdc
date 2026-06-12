import { describe, expect, it } from "vitest";

import {
  buildReverseProxyConfigurationBlock,
  HDC_REVERSE_PROXY_BEGIN,
  mergeHomeAssistantConfigurationYaml,
  proxmoxVolumeToDevPath,
  reverseProxyConfigurationInSync,
  stripManagedReverseProxyBlocks,
} from "../../../packages/services/homeassistant/lib/haos-reverse-proxy-config.mjs";
import { publicUrlNeedsReverseProxy } from "../../../packages/services/homeassistant/lib/reverse-proxy-apply.mjs";
import { resolveNginxWafTrustedProxies } from "../../../packages/services/homeassistant/lib/resolve-nginx-waf-proxies.mjs";

describe("homeassistant reverse proxy config", () => {
  const baseYaml = [
    "default_config:",
    "frontend:",
    "  themes: !include_dir_merge_named themes",
    "",
  ].join("\n");

  it("buildReverseProxyConfigurationBlock includes trusted_proxies and URLs", () => {
    const block = buildReverseProxyConfigurationBlock({
      trustedProxies: ["10.0.0.40", "10.0.0.41"],
      externalUrl: "https://ha.dukk.org",
      internalUrl: "http://10.0.0.39:8123",
    });
    expect(block).toContain(HDC_REVERSE_PROXY_BEGIN);
    expect(block).toContain("- 10.0.0.40");
    expect(block).toContain("external_url: https://ha.dukk.org");
    expect(block).toContain("internal_url: http://10.0.0.39:8123");
  });

  it("mergeHomeAssistantConfigurationYaml replaces managed block idempotently", () => {
    const block = buildReverseProxyConfigurationBlock({
      trustedProxies: ["10.0.0.40"],
      externalUrl: "https://ha.example.invalid",
      internalUrl: "http://10.0.0.39:8123",
    });
    const once = mergeHomeAssistantConfigurationYaml(baseYaml, block);
    const twice = mergeHomeAssistantConfigurationYaml(once, block);
    expect(once).toBe(twice);
    expect(stripManagedReverseProxyBlocks(twice).trim()).toBe(baseYaml.trim());
  });

  it("reverseProxyConfigurationInSync detects matching content", () => {
    const merged = mergeHomeAssistantConfigurationYaml(
      baseYaml,
      buildReverseProxyConfigurationBlock({
        trustedProxies: ["10.0.0.40", "10.0.0.41"],
        externalUrl: "https://ha.dukk.org",
        internalUrl: "http://10.0.0.39:8123",
      }),
    );
    expect(
      reverseProxyConfigurationInSync(merged, {
        trustedProxies: ["10.0.0.40", "10.0.0.41"],
        externalUrl: "https://ha.dukk.org",
        internalUrl: "http://10.0.0.39:8123",
      }),
    ).toBe(true);
  });

  it("proxmoxVolumeToDevPath maps LVM volume refs", () => {
    expect(proxmoxVolumeToDevPath("local-lvm:vm-121-disk-1")).toBe("/dev/pve/vm-121-disk-1");
    expect(proxmoxVolumeToDevPath("local-lvm:vm-121-disk-1,discard=on")).toBe("/dev/pve/vm-121-disk-1");
  });

  it("publicUrlNeedsReverseProxy requires https", () => {
    expect(publicUrlNeedsReverseProxy("https://ha.dukk.org")).toBe(true);
    expect(publicUrlNeedsReverseProxy("http://10.0.0.39:8123")).toBe(false);
    expect(publicUrlNeedsReverseProxy("")).toBe(false);
  });

  it("resolveNginxWafTrustedProxies honors overrideIps", () => {
    const ips = resolveNginxWafTrustedProxies("/nonexistent", {
      overrideIps: ["10.0.0.40", "10.0.0.41"],
    });
    expect(ips).toEqual(["10.0.0.40", "10.0.0.41"]);
  });
});
