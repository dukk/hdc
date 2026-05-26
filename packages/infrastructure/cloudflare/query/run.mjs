#!/usr/bin/env node
/**
 * Cloudflare DNS query: list account zones and diff vs config (JSON on stdout).
 *
 * Usage: hdc run infrastructure cloudflare query -- [--zone <name>]
 */
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stderr as errout } from "node:process";

import { loadPackageConfigFromPackageRoot } from "../../../lib/package-run-config.mjs";
import { parseArgvFlags, flagGet } from "../../../lib/parse-argv-flags.mjs";
import { createCloudflareClient } from "../lib/cloudflare-api.mjs";
import { normalizeCloudflareConfig } from "../lib/cloudflare-config.mjs";
import { collectCloudflareDnsState } from "../lib/cloudflare-collect.mjs";
import { createCloudflareVaultAccess, resolveCloudflareToken } from "../lib/vault-deps.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const target = basename(dirname(here));
const verb = basename(here);
const packageRoot = join(here, "..");
const PACKAGE_CONFIG_EXAMPLE = "packages/infrastructure/cloudflare/config.example.json";

/**
 * @param {string} line
 */
function log(line) {
  errout.write(`[cloudflare] ${line}\n`);
}

async function main() {
  log(`${verb}: starting`);
  const flags = parseArgvFlags(process.argv.slice(2));
  const zoneName = flagGet(flags, "zone");

  const { data: cfgRaw, source } = loadPackageConfigFromPackageRoot(packageRoot, {
    exampleRel: PACKAGE_CONFIG_EXAMPLE,
    log: (line) => errout.write(line),
  });
  log(`config loaded (${source})`);

  const config = normalizeCloudflareConfig(cfgRaw);
  const vault = createCloudflareVaultAccess();
  const token = await resolveCloudflareToken(vault);
  log(`vault: ${"HDC_CLOUDFLARE_API_TOKEN"} loaded`);

  const api = createCloudflareClient({
    token,
    baseUrl: config.apiBase,
    accountId: config.accountId,
  });

  log("fetching zones and DNS records from Cloudflare API");
  const state = await collectCloudflareDnsState({
    config,
    api,
    zoneFilterName: zoneName,
  });

  const payload = {
    ok: state.missing_configured_zones.length === 0,
    verb: "query",
    package: "cloudflare",
    config_source: source,
    zone_filter: config.zoneFilter,
    managed_zone_names: config.zones.map((z) => z.name),
    account_zones: state.account_zones,
    unmanaged_zones: state.unmanaged_zones,
    missing_configured_zones: state.missing_configured_zones,
    zones_scanned: state.zones_scanned,
    collected_at: new Date().toISOString(),
  };

  if (state.missing_configured_zones.length) {
    log(
      `warning: configured zones not in account: ${state.missing_configured_zones.join(", ")}`
    );
  }
  log(
    `done: ${state.account_zones.length} managed, ${state.unmanaged_zones.length} unmanaged in scan`
  );

  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  if (state.missing_configured_zones.length) process.exitCode = 1;
}

main().catch((e) => {
  log(`failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
