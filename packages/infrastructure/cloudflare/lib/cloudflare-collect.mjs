import { createCloudflareClient } from "./cloudflare-api.mjs";
import { normalizeZoneName, zonePassesFilter } from "./cloudflare-config.mjs";
import { planZoneSync } from "./cloudflare-sync.mjs";

/**
 * @param {object} opts
 * @param {ReturnType<import('./cloudflare-config.mjs').normalizeCloudflareConfig>} opts.config
 * @param {ReturnType<typeof createCloudflareClient>} opts.api
 * @param {string | undefined} [opts.zoneFilterName]
 */
export async function collectCloudflareDnsState(opts) {
  const { config, api, zoneFilterName } = opts;
  const onlyZone = zoneFilterName ? normalizeZoneName(zoneFilterName) : null;

  const allZones = await api.listZones();
  const filtered = allZones.filter((z) => zonePassesFilter(z.name, config.zoneFilter));
  const zonesToScan = onlyZone ? filtered.filter((z) => z.name === onlyZone) : filtered;

  if (onlyZone && zonesToScan.length === 0) {
    const inAccount = allZones.some((z) => z.name === onlyZone);
    if (!inAccount) {
      throw new Error(`Zone not found in Cloudflare account: ${onlyZone}`);
    }
    throw new Error(`Zone excluded by cloudflare.zone_filter: ${onlyZone}`);
  }

  /** @type {object[]} */
  const accountZones = [];
  /** @type {object[]} */
  const unmanagedZones = [];

  for (const zone of zonesToScan) {
    const live = await api.listDnsRecords(zone.id);
    const configZone = config.zonesByName.get(zone.name);
    const managed = Boolean(configZone);

    if (!managed) {
      unmanagedZones.push({
        name: zone.name,
        zone_id: zone.id,
        status: zone.status,
        record_count: live.length,
      });
      continue;
    }

    const plan = planZoneSync({
      desired: configZone.records,
      live,
      zoneName: zone.name,
      prune: false,
    });

    accountZones.push({
      name: zone.name,
      zone_id: zone.id,
      status: zone.status,
      managed: true,
      record_count: live.length,
      desired_count: configZone.records.length,
      diff: plan.summary,
    });
  }

  /** @type {string[]} */
  const missingFromAccount = [];
  for (const cz of config.zones) {
    if (onlyZone && cz.name !== onlyZone) continue;
    const found = allZones.some((z) => z.name === cz.name);
    if (!found) missingFromAccount.push(cz.name);
  }

  return {
    account_zones: accountZones,
    unmanaged_zones: unmanagedZones,
    missing_configured_zones: missingFromAccount,
    zones_scanned: zonesToScan.length,
  };
}
