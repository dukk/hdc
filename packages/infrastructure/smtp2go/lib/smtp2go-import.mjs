import { stderr as errout } from "node:process";

import { loadPackageConfigFromPackageRoot } from "../../../lib/package-run-config.mjs";
import { writeResolvedRepoJson } from "../../../../tools/hdc/lib/private-repo.mjs";
import { liveDomainToConfig } from "./smtp2go-config.mjs";

export const SMTP2GO_COMPACT_ARRAY_KEYS = ["sender_domains"];

const PACKAGE_CONFIG_EXAMPLE = "packages/infrastructure/smtp2go/config.example.json";

/**
 * @param {{ senderDomains: import('./smtp2go-api.mjs').Smtp2goSenderDomainRow[] }} live
 * @param {Map<string, import('./smtp2go-config.mjs').ConfigSenderDomain>} existingByFqdn
 */
export function liveStateToSenderDomains(live, existingByFqdn) {
  return live.senderDomains
    .map((row) => {
      const fqdn =
        typeof row.domain?.fulldomain === "string"
          ? row.domain.fulldomain.trim().toLowerCase()
          : "";
      if (!fqdn) return null;
      const existing = existingByFqdn.get(fqdn) ?? null;
      return liveDomainToConfig(row, existing);
    })
    .filter(Boolean)
    .sort((a, b) => a.domain.localeCompare(b.domain));
}

/**
 * @param {object} opts
 * @param {string} opts.packageRoot
 * @param {{ senderDomains: import('./smtp2go-api.mjs').Smtp2goSenderDomainRow[] }} opts.live
 * @param {(line: string) => void} [opts.log]
 */
export function importSmtp2goToConfig(opts) {
  const log = opts.log ?? (() => {});
  const { data: cfgRaw, resolved, source } = loadPackageConfigFromPackageRoot(opts.packageRoot, {
    exampleRel: PACKAGE_CONFIG_EXAMPLE,
    log: (line) => errout.write(line),
  });

  const config = /** @type {import('./smtp2go-config.mjs').ConfigSenderDomain[]} */ (
    Array.isArray(cfgRaw.sender_domains) ? cfgRaw.sender_domains : []
  );
  const existingByFqdn = new Map(
    config
      .filter((d) => d && typeof d.domain === "string")
      .map((d) => [String(d.domain).trim().toLowerCase(), d])
  );

  const sender_domains = liveStateToSenderDomains(opts.live, existingByFqdn);

  const next = {
    ...cfgRaw,
    sender_domains,
  };

  writeResolvedRepoJson(resolved, next, { compactArrayKeys: SMTP2GO_COMPACT_ARRAY_KEYS });
  log(
    `Wrote ${sender_domains.length} sender domain(s) to config (${source}: ${resolved.rel}).`
  );

  return {
    sender_domain_count: sender_domains.length,
    configRel: resolved.rel,
  };
}
