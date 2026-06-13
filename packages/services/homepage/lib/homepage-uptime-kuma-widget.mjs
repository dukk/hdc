import { stderr as errout } from "node:process";

import { loadPackageConfigFromPackageRoot } from "../../../lib/package-run-config.mjs";
import { ipFromIpConfig, isObject, serviceUrlFromPublicUrlOrHostPort, widgetBlockEnabled } from "./homepage-widget-utils.mjs";

/** @param {unknown} v */
function isObjectLocal(v) {
  return isObject(v);
}

/**
 * @param {Record<string, unknown>} cfg
 */
function normalizeUptimeKumaConfig(cfg) {
  if (!isObjectLocal(cfg) || !Array.isArray(cfg.deployments) || cfg.deployments.length === 0) {
    throw new Error("uptime-kuma config needs deployments[]");
  }
  const defaults = isObjectLocal(cfg.defaults) ? cfg.defaults : {};
  return { defaults, deployments: cfg.deployments.filter(isObjectLocal) };
}

/**
 * @param {Record<string, unknown>} homepage
 */
export function uptimeKumaWidgetEnabled(homepage) {
  return widgetBlockEnabled(homepage, "uptime_kuma_widget");
}

/**
 * @param {object} opts
 * @param {Record<string, unknown>} opts.homepage
 * @param {string} opts.uptimeKumaPackageRoot
 * @param {boolean} [opts.dryRun]
 */
export async function resolveHomepageUptimeKumaWidgetEnv(opts) {
  const { homepage, uptimeKumaPackageRoot, dryRun = false } = opts;
  if (!uptimeKumaWidgetEnabled(homepage)) return null;

  errout.write("[hdc] homepage: resolving Uptime Kuma widget env …\n");

  const widget = /** @type {Record<string, unknown>} */ (homepage.uptime_kuma_widget);
  const slug = typeof widget.slug === "string" ? widget.slug.trim() : "";
  if (!slug) {
    throw new Error(
      "homepage uptime_kuma_widget.slug is required (status page slug from Uptime Kuma URL /status/<slug>)",
    );
  }

  const loaded = loadPackageConfigFromPackageRoot(uptimeKumaPackageRoot, {
    exampleRel: "packages/services/uptime-kuma/config.example.json",
  });
  const { defaults, deployments } = normalizeUptimeKumaConfig(loaded.data);
  const deployment = deployments[0];
  const defaultUk = isObject(defaults.uptime_kuma) ? defaults.uptime_kuma : {};
  const deployUk = isObject(deployment.uptime_kuma) ? deployment.uptime_kuma : {};
  const merged = { ...defaultUk, ...deployUk };
  const portRaw = typeof merged.port === "number" ? merged.port : Number(merged.port);
  const port = Number.isFinite(portRaw) && portRaw > 0 ? Math.floor(portRaw) : 3001;

  const px = isObject(deployment.proxmox) ? deployment.proxmox : {};
  const lxc = isObject(px.lxc) ? px.lxc : {};
  const ip = ipFromIpConfig(typeof lxc.ip_config === "string" ? lxc.ip_config : "");
  const url = serviceUrlFromPublicUrlOrHostPort(
    typeof merged.public_url === "string" ? merged.public_url : "",
    ip ?? "",
    port,
  );
  if (!url) {
    throw new Error("homepage uptime_kuma_widget: static proxmox.lxc.ip_config required on first deployment");
  }

  if (dryRun) {
    return { lines: [`# dry-run: would inject HOMEPAGE_VAR_UPTIME_KUMA_* slug=${slug}`], url, slug };
  }

  errout.write(`[hdc] homepage: Uptime Kuma widget env ready (${url}, slug ${JSON.stringify(slug)}).\n`);

  return {
    lines: [`HOMEPAGE_VAR_UPTIME_KUMA_URL=${url}`, `HOMEPAGE_VAR_UPTIME_KUMA_SLUG=${slug}`],
    url,
    slug,
  };
}
