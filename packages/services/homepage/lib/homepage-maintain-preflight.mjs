import { join } from "node:path";
import { stderr as errout } from "node:process";

import { loadHomepageConfigFiles } from "./homepage-config-load.mjs";
import { lintHomepageServicesFromConfig } from "./homepage-services-lint.mjs";

/**
 * @param {Record<string, unknown>} homepage
 * @param {string} packageRoot
 */
export function runHomepageServicesLint(homepage, packageRoot) {
  const loaded = loadHomepageConfigFiles(homepage, packageRoot);
  const result = lintHomepageServicesFromConfig(homepage, loaded.servicesYaml, packageRoot);
  for (const warning of result.warnings) {
    errout.write(`[hdc] homepage lint WARN: ${warning}\n`);
  }
  if (!result.ok) {
    throw new Error(`homepage services.yaml lint failed:\n- ${result.errors.join("\n- ")}`);
  }
  errout.write(`[hdc] homepage lint OK (${result.service_count} service tile(s)).\n`);
  return result;
}

/**
 * @param {string} root repo root from repoRoot()
 */
export function homepageWidgetPackageRoots(root) {
  return {
    proxmoxPackageRoot: join(root, "packages", "infrastructure", "proxmox"),
    piholePackageRoot: join(root, "packages", "services", "pi-hole"),
    immichPackageRoot: join(root, "packages", "services", "immich"),
    glancesPackageRoot: join(root, "packages", "services", "glances"),
    homeassistantPackageRoot: join(root, "packages", "services", "homeassistant"),
    audiobookshelfPackageRoot: join(root, "packages", "services", "audiobookshelf"),
    uptimeKumaPackageRoot: join(root, "packages", "services", "uptime-kuma"),
    crowdsecPackageRoot: join(root, "packages", "services", "crowdsec"),
  };
}
