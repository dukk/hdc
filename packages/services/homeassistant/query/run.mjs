#!/usr/bin/env node
/**
 * Query Home Assistant deployment status.
 *
 * Usage: hdc run service homeassistant query -- [--instance a | --system-id vm-homeassistant-a]
 *        hdc run service homeassistant query -- --live
 */
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { stderr as errout } from "node:process";

import { repoRoot } from "../../../../tools/hdc/paths.mjs";
import { parseArgvFlags, flagGet } from "../../../lib/parse-argv-flags.mjs";
import {
  listHomeassistantDeploymentSummaries,
  normalizeHomeassistantConfig,
  resolveHomeassistantDeployments,
} from "../lib/deployments.mjs";
import { probeHomeAssistantHttp } from "../lib/query-status.mjs";
import { authorizeProxmoxForHost } from "../../../infrastructure/proxmox/lib/proxmox-deploy-auth.mjs";
import { locateGuest } from "../../bind/lib/proxmox-qemu-redeploy.mjs";
import { loadPackageConfigFromPackageRoot, tryLoadPackageConfigFromPackageRoot } from "../../../lib/package-run-config.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, "..");
const PACKAGE_CONFIG_EXAMPLE = "packages/services/homeassistant/config.example.json";
const target = basename(dirname(here));
const verb = basename(here);
const root = repoRoot();
const proxmoxRoot = join(root, "packages", "infrastructure", "proxmox");

/** @type {{ data: Record<string, unknown>; path: string; source: string } | null} */
let _pkgConfig = null;
function ensurePackageConfig() {
  if (!_pkgConfig) {
    _pkgConfig = loadPackageConfigFromPackageRoot(packageRoot, { exampleRel: PACKAGE_CONFIG_EXAMPLE });
  }
  return _pkgConfig;
}

async function main() {
  const rel = relative(root, ensurePackageConfig().path).replace(/\\/g, "/");
  const loaded = tryLoadPackageConfigFromPackageRoot(packageRoot, { exampleRel: PACKAGE_CONFIG_EXAMPLE });
  const cfg = loaded.ok && loaded.data ? loaded.data : null;
  const flags = parseArgvFlags(process.argv.slice(2));
  const live = flagGet(flags, "live") !== undefined;

  errout.write(`[hdc] ${target} ${verb}: config ${rel} ${loaded.ok ? "loaded" : "not loaded"}.\n`);

  /** @type {unknown[]} */
  let deployments = [];
  /** @type {string | null} */
  let configError = null;
  let schemaVersion = null;

  if (cfg) {
    try {
      const norm = normalizeHomeassistantConfig(cfg);
      schemaVersion = norm.schemaVersion;
      deployments = listHomeassistantDeploymentSummaries(cfg);
    } catch (e) {
      configError = String(/** @type {Error} */ (e).message || e);
    }
  }

  /** @type {Record<string, unknown>[]} */
  const liveResults = [];

  if (live && cfg && !configError) {
    try {
      const selected = resolveHomeassistantDeployments(cfg, flags);
      errout.write(`[hdc] ${target} ${verb}: live status for ${selected.length} deployment(s) …\n`);
      for (const d of selected) {
        const hostId = d.proxmox.hostId;
        const vmid = d.proxmox.qemu.vmid;
        const ipHost = d.proxmox.qemu.ip.split("/")[0];
        try {
          const auth = await authorizeProxmoxForHost({ packageRoot: proxmoxRoot, hostId });
          const located = await locateGuest(
            auth.host.apiBase,
            auth.authorization,
            auth.rejectUnauthorized,
            vmid,
          );
          const http = await probeHomeAssistantHttp(ipHost);
          liveResults.push({
            system_id: d.systemId,
            ok: Boolean(located) && http.ok,
            vmid,
            node: located?.node ?? null,
            guest_name: located?.name ?? null,
            http,
          });
        } catch (e) {
          liveResults.push({
            system_id: d.systemId,
            ok: false,
            message: String(/** @type {Error} */ (e).message || e),
          });
        }
      }
    } catch (e) {
      configError = String(/** @type {Error} */ (e).message || e);
    }
  }

  const payload = {
    ok: !configError,
    target,
    verb,
    stub: false,
    schema_version: schemaVersion,
    config_error: configError,
    deployments,
    live: live ? liveResults : undefined,
    generated_at: new Date().toISOString(),
  };

  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exitCode = configError ? 1 : 0;
}

main();
