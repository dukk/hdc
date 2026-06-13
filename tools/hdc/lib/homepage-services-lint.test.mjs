import { describe, expect, it } from "vitest";

import { lintHomepageServicesYaml } from "../../../packages/services/homepage/lib/homepage-services-lint.mjs";
import { parseHomepageServicesYaml } from "../../../packages/services/homepage/lib/homepage-services-parse.mjs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "../../../packages/services/homepage");

describe("homepage-services-parse", () => {
  it("parses group, service, icon, and widget", () => {
    const yaml = `- Media:
    - Immich:
        icon: immich.png
        href: https://immich.example.invalid
        widget:
          type: immich
          url: "{{HOMEPAGE_VAR_IMMICH_URL}}"
          key: "{{HOMEPAGE_VAR_IMMICH_KEY}}"
`;
    const groups = parseHomepageServicesYaml(yaml);
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe("Media");
    expect(groups[0].services[0].name).toBe("Immich");
    expect(groups[0].services[0].icon).toBe("immich.png");
    expect(groups[0].services[0].widget?.type).toBe("immich");
  });
});

describe("homepage-services-lint", () => {
  it("errors when icon is missing", () => {
    const result = lintHomepageServicesYaml({
      servicesYaml: `- Misc.:
    - Broken:
        href: http://example.invalid
`,
      homepage: {},
      packageRoot,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("missing icon"))).toBe(true);
  });

  it("errors when immich_widget enabled but tile has no widget", () => {
    const result = lintHomepageServicesYaml({
      servicesYaml: `- Media:
    - Immich:
        icon: immich.png
        href: https://immich.example.invalid
`,
      homepage: { immich_widget: { enabled: true } },
      packageRoot,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("immich_widget"))).toBe(true);
  });

  it("passes immich tile with widget placeholders when enabled", () => {
    const result = lintHomepageServicesYaml({
      servicesYaml: `- Media:
    - Immich:
        icon: immich.png
        widget:
          type: immich
          url: "{{HOMEPAGE_VAR_IMMICH_URL}}"
          key: "{{HOMEPAGE_VAR_IMMICH_KEY}}"
`,
      homepage: { immich_widget: { enabled: true } },
      packageRoot,
    });
    expect(result.ok).toBe(true);
  });

  it("errors on missing vendored icon path", () => {
    const result = lintHomepageServicesYaml({
      servicesYaml: `- Misc.:
    - YaCy A:
        icon: /icons/missing-icon.png
`,
      homepage: {},
      packageRoot,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("missing-icon.png"))).toBe(true);
  });
});
