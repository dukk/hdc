import { describe, expect, it } from "vitest";

import {
  buildReverseProxyConfigurationBlock,
  HDC_REVERSE_PROXY_BEGIN,
  mergeHomeAssistantConfigurationYaml,
  proxmoxVolumeToDevPath,
  reverseProxyConfigurationInSync,
  stripManagedReverseProxyBlocks,
} from "hdc/clump/services/homeassistant/lib/haos-reverse-proxy-config.mjs";
import { publicUrlNeedsReverseProxy } from "hdc/clump/services/homeassistant/lib/reverse-proxy-apply.mjs";
import { resolveNginxWafTrustedProxies } from "hdc/clump/services/homeassistant/lib/resolve-nginx-waf-proxies.mjs";

describe("homeassistant reverse proxy config", () => {
  const baseYaml = [
    "default_config:",
    "frontend:",
    "  themes: !include_dir_merge_named themes",
    "",
  ].join("\n");

  it("buildReverseProxyConfigurationBlock includes trusted_proxies only", () => {
    const block = buildReverseProxyConfigurationBlock({
      trustedProxies: ["192.0.2.40", "192.0.2.41"],
    });
    expect(block).toContain(HDC_REVERSE_PROXY_BEGIN);
    expect(block).toContain("- 192.0.2.40");
    expect(block).toContain("- 192.0.2.41");
    expect(block).toContain("use_x_forwarded_for: true");
    expect(block).not.toContain("homeassistant:");
    expect(block).not.toContain("external_url:");
    expect(block).not.toContain("internal_url:");
  });

  it("mergeHomeAssistantConfigurationYaml replaces managed block idempotently", () => {
    const block = buildReverseProxyConfigurationBlock({
      trustedProxies: ["192.0.2.40"],
    });
    const once = mergeHomeAssistantConfigurationYaml(baseYaml, block);
    const twice = mergeHomeAssistantConfigurationYaml(once, block);
    expect(once).toBe(twice);
    expect(stripManagedReverseProxyBlocks(twice).trim()).toBe(baseYaml.trim());
  });

  it("merge strips legacy homeassistant URL keys from managed block", () => {
    const legacy = mergeHomeAssistantConfigurationYaml(
      baseYaml,
      [
        HDC_REVERSE_PROXY_BEGIN,
        "http:",
        "  use_x_forwarded_for: true",
        "  trusted_proxies:",
        "    - 192.0.2.40",
        "homeassistant:",
        "  external_url: https://ha.example.invalid",
        "  internal_url: http://192.0.2.39:8123",
        "# hdc: reverse-proxy end",
        "",
      ].join("\n"),
    );
    const updated = mergeHomeAssistantConfigurationYaml(
      legacy,
      buildReverseProxyConfigurationBlock({ trustedProxies: ["192.0.2.40"] }),
    );
    expect(updated).toContain("- 192.0.2.40");
    expect(updated).not.toContain("homeassistant:");
    expect(updated).not.toContain("external_url:");
  });

  it("merge strips orphaned homeassistant URL block outside markers", () => {
    const orphaned = [
      baseYaml.trimEnd(),
      "",
      "homeassistant:",
      "  external_url: https://ha.example.invalid",
      "  internal_url: http://192.0.2.39:8123",
      "",
      HDC_REVERSE_PROXY_BEGIN,
      "http:",
      "  use_x_forwarded_for: true",
      "  trusted_proxies:",
      "    - 192.0.2.40",
      "# hdc: reverse-proxy end",
      "",
    ].join("\n");
    const updated = mergeHomeAssistantConfigurationYaml(
      orphaned,
      buildReverseProxyConfigurationBlock({ trustedProxies: ["192.0.2.40"] }),
    );
    expect(updated).not.toContain("homeassistant:");
    expect(updated).not.toContain("external_url:");
    expect(updated).toContain("- 192.0.2.40");
    expect(
      reverseProxyConfigurationInSync(orphaned, { trustedProxies: ["192.0.2.40"] }),
    ).toBe(false);
  });

  it("stripOrphanedHomeassistantUrlBlock keeps location keys", async () => {
    const { stripOrphanedHomeassistantUrlBlock } = await import(
      "hdc/clump/services/homeassistant/lib/haos-reverse-proxy-config.mjs"
    );
    const kept = stripOrphanedHomeassistantUrlBlock(
      ["homeassistant:", "  latitude: 1.0", "  external_url: https://ha.example.invalid", ""].join(
        "\n",
      ),
    );
    expect(kept).toContain("homeassistant:");
    expect(kept).toContain("latitude: 1.0");
  });

  it("reverseProxyConfigurationInSync detects matching content", () => {
    const merged = mergeHomeAssistantConfigurationYaml(
      baseYaml,
      buildReverseProxyConfigurationBlock({
        trustedProxies: ["192.0.2.40", "192.0.2.41"],
      }),
    );
    expect(
      reverseProxyConfigurationInSync(merged, {
        trustedProxies: ["192.0.2.40", "192.0.2.41"],
      }),
    ).toBe(true);
  });

  it("proxmoxVolumeToDevPath maps LVM volume refs", () => {
    expect(proxmoxVolumeToDevPath("local-lvm:vm-121-disk-1")).toBe("/dev/pve/vm-121-disk-1");
    expect(proxmoxVolumeToDevPath("local-lvm:vm-121-disk-1,discard=on")).toBe("/dev/pve/vm-121-disk-1");
  });

  it("publicUrlNeedsReverseProxy requires https", () => {
    expect(publicUrlNeedsReverseProxy("https://ha.example.invalid")).toBe(true);
    expect(publicUrlNeedsReverseProxy("http://192.0.2.39:8123")).toBe(false);
    expect(publicUrlNeedsReverseProxy("")).toBe(false);
  });

  it("resolveNginxWafTrustedProxies honors overrideIps", () => {
    const ips = resolveNginxWafTrustedProxies("/nonexistent", {
      overrideIps: ["192.0.2.40", "192.0.2.41"],
    });
    expect(ips).toEqual(["192.0.2.40", "192.0.2.41"]);
  });
});
