import { describe, expect, it } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  resolveHomepageUnifiWidgetEnv,
  unifiWidgetEnabled,
} from "hdc/clump/services/homepage/lib/homepage-unifi-widget.mjs";
import { lintHomepageServicesYaml } from "hdc/clump/services/homepage/lib/homepage-services-lint.mjs";

const unifiNetworkPackageRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../hdc-clumps/infrastructure/unifi-network",
);
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "../../../../hdc-clumps/services/homepage");

describe("homepage unifi widget", () => {
  it("unifiWidgetEnabled respects enabled flag", () => {
    expect(unifiWidgetEnabled({ unifi_widget: { enabled: true } })).toBe(true);
    expect(unifiWidgetEnabled({ unifi_widget: { enabled: false } })).toBe(false);
    expect(unifiWidgetEnabled({})).toBe(false);
  });

  it("resolveHomepageUnifiWidgetEnv dry-run uses example unifi-network config", async () => {
    const result = await resolveHomepageUnifiWidgetEnv({
      homepage: { unifi_widget: { enabled: true } },
      unifiNetworkPackageRoot,
      vaultAccess: /** @type {never} */ (null),
      dryRun: true,
    });
    expect(result).not.toBeNull();
    expect(result?.lines[0]).toContain("HOMEPAGE_VAR_UNIFI_");
    expect(result?.lines[0]).toContain("HDC_UNIFI_NETWORK_API_KEY");
    expect(result?.url).toMatch(/^https:\/\//);
    expect(result?.site).toBeNull();
  });

  it("dry-run injects site only when unifi_widget.site is set", async () => {
    const result = await resolveHomepageUnifiWidgetEnv({
      homepage: { unifi_widget: { enabled: true, site: "My Site" } },
      unifiNetworkPackageRoot,
      vaultAccess: /** @type {never} */ (null),
      dryRun: true,
    });
    expect(result?.site).toBe("My Site");
  });

  it("returns null when widget disabled", async () => {
    const result = await resolveHomepageUnifiWidgetEnv({
      homepage: { unifi_widget: { enabled: false } },
      unifiNetworkPackageRoot,
      vaultAccess: /** @type {never} */ (null),
      dryRun: true,
    });
    expect(result).toBeNull();
  });
});

describe("homepage-services-lint unifi", () => {
  it("passes UniFi tile with widget placeholders when enabled", () => {
    const result = lintHomepageServicesYaml({
      servicesYaml: `- Infrastructure:
    - UniFi:
        icon: unifi.png
        href: https://unifi.example.invalid
        ping: 192.0.2.1
        widget:
          type: unifi
          url: "{{HOMEPAGE_VAR_UNIFI_URL}}"
          key: "{{HOMEPAGE_VAR_UNIFI_KEY}}"
`,
      homepage: { unifi_widget: { enabled: true } },
      packageRoot,
    });
    expect(result.ok).toBe(true);
  });
});
