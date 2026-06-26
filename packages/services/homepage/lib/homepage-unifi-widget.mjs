import { stderr as errout } from "node:process";

import { controllerFromPackageConfig } from "../../../infrastructure/unifi-network/lib/unifi-config.mjs";
import { UNIFI_API_KEY_VAULT_KEY } from "../../../infrastructure/unifi-network/lib/vault-deps.mjs";
import { loadPackageConfigFromPackageRoot } from "../../../lib/package-run-config.mjs";
import {
  readRequiredVaultSecret,
  vaultKeyFromWidget,
  widgetBlockEnabled,
} from "./homepage-widget-utils.mjs";

/**
 * @param {Record<string, unknown>} homepage
 */
export function unifiWidgetEnabled(homepage) {
  return widgetBlockEnabled(homepage, "unifi_widget");
}

/**
 * @param {object} opts
 * @param {Record<string, unknown>} opts.homepage
 * @param {string} opts.unifiNetworkPackageRoot
 * @param {import("../../../lib/package-vault-access.mjs").PackageVaultAccess} opts.vaultAccess
 * @param {boolean} [opts.dryRun]
 */
export async function resolveHomepageUnifiWidgetEnv(opts) {
  const { homepage, unifiNetworkPackageRoot, vaultAccess, dryRun = false } = opts;
  if (!unifiWidgetEnabled(homepage)) return null;

  errout.write("[hdc] homepage: resolving UniFi widget env …\n");

  const loaded = loadPackageConfigFromPackageRoot(unifiNetworkPackageRoot, {
    exampleRel: "packages/infrastructure/unifi-network/config.example.json",
  });
  const controller = controllerFromPackageConfig(loaded.data);
  if (!controller?.url) {
    throw new Error("homepage unifi_widget: unifi-network controller_base_url required");
  }
  const url = controller.url.replace(/\/+$/, "");

  const siteRaw =
    typeof loaded.data.default_site_id === "string" ? loaded.data.default_site_id.trim() : "";
  const site =
    typeof homepage.unifi_widget === "object" &&
    homepage.unifi_widget !== null &&
    !Array.isArray(homepage.unifi_widget) &&
    typeof /** @type {Record<string, unknown>} */ (homepage.unifi_widget).site === "string" &&
    /** @type {Record<string, unknown>} */ (homepage.unifi_widget).site.trim()
      ? /** @type {Record<string, unknown>} */ (homepage.unifi_widget).site.trim()
      : siteRaw;

  const widget = /** @type {Record<string, unknown>} */ (homepage.unifi_widget);
  const vaultKey = vaultKeyFromWidget(widget, "api_key_vault_key", UNIFI_API_KEY_VAULT_KEY);

  if (dryRun) {
    return {
      lines: [`# dry-run: would inject HOMEPAGE_VAR_UNIFI_* (vault ${vaultKey})`],
      vault_key: vaultKey,
      url,
      site: site || null,
    };
  }

  const apiKey = await readRequiredVaultSecret(
    vaultAccess,
    vaultKey,
    `homepage unifi_widget requires Integration API key in ${vaultKey} (Settings → Control plane → Integrations)`,
  );

  /** @type {string[]} */
  const lines = [`HOMEPAGE_VAR_UNIFI_URL=${url}`, `HOMEPAGE_VAR_UNIFI_KEY=${apiKey}`];
  if (site) {
    lines.push(`HOMEPAGE_VAR_UNIFI_SITE=${site}`);
  }

  errout.write(
    `[hdc] homepage: UniFi widget env ready (${url}${site ? `, site ${JSON.stringify(site)}` : ""}).\n`,
  );

  return {
    lines,
    vault_key: vaultKey,
    url,
    site: site || null,
  };
}
