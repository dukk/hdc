import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stderr as errout } from "node:process";

import { repoRoot } from "../../../apps/hdc-cli/paths.mjs";
import { parseArgvFlags, flagGet } from "../parse-argv-flags.mjs";
import { resolveFamily } from "./families.mjs";
import { probeDns, probeHttp, probeWafHosts } from "./layers.mjs";
import { resolveHealthEndpoints, joinUrlPath, hostnameFromUrl } from "./resolve-endpoints.mjs";
import { probeGuest, probeInfraApiConfig, probeClientReachability } from "./guest-checks.mjs";
import { deriveHealthStatus, statusIsOk } from "./status.mjs";

/**
 * @param {object} opts
 * @param {string} opts.clumpRoot Absolute path to clump package root
 * @param {string} [opts.packageId]
 * @param {string} [opts.family]
 * @param {Record<string, unknown>} [opts.probe] path, port, public_url, hostname, guest_ip
 * @param {string[]} [opts.argv]
 * @param {(line: string) => void} [opts.log]
 */
export async function runServiceHealth(opts) {
  const clumpRoot = opts.clumpRoot;
  const packageId = opts.packageId || basename(clumpRoot);
  const family = resolveFamily(packageId, opts.family);
  const log = opts.log ?? ((line) => errout.write(`${line}\n`));
  const argv = opts.argv ?? process.argv.slice(2);
  const flags = parseArgvFlags(argv);
  const instance = flagGet(flags, "instance") ?? flagGet(flags, "system-id") ?? null;
  const root = repoRoot();

  log(`[hdc] ${packageId} health: family=${family}`);

  const endpoints = resolveHealthEndpoints({
    repoRoot: root,
    clumpRoot,
    packageId,
    probe: opts.probe ?? {},
    instance: instance ? String(instance) : undefined,
  });

  /** @type {Record<string, unknown>[]} */
  const instancesOut = [];
  /** @type {string[]} */
  const statuses = [];

  for (const inst of endpoints.instances) {
    log(`[hdc] ${packageId} health: probing instance ${inst.id} (${inst.system_id})`);
    /** @type {Record<string, unknown>} */
    const layers = {};

    if (family === "infra-api") {
      layers.api = probeInfraApiConfig(endpoints.config_loaded);
      if (endpoints.public_url) {
        layers.public = probeHttp({ url: endpoints.public_url, insecure: true });
      } else {
        layers.public = { ok: null, skipped: true, detail: "no public url" };
      }
      layers.dns = { ok: null, skipped: true, detail: "infra-api" };
      layers.waf = { ok: null, skipped: true, detail: "infra-api" };
      layers.direct = { ok: null, skipped: true, detail: "infra-api" };
      layers.guest = { ok: null, skipped: true, detail: "infra-api" };
    } else if (family === "client") {
      layers.client = await probeClientReachability(inst.guest_ip);
      layers.dns = { ok: null, skipped: true, detail: "client" };
      layers.public = { ok: null, skipped: true, detail: "client" };
      layers.waf = { ok: null, skipped: true, detail: "client" };
      layers.direct = { ok: null, skipped: true, detail: "client" };
      layers.guest = { ok: null, skipped: true, detail: "client" };
    } else if (family === "self-edge") {
      // nginx / nginx-waf: probe own LAN IPs and optional hostnames
      const host = inst.hostname || endpoints.hostname || "localhost";
      layers.dns = await probeDns(host === "localhost" ? "" : host);
      const ips = endpoints.waf_ips.length ? endpoints.waf_ips : inst.guest_ip ? [inst.guest_ip] : [];
      if (ips.length) {
        layers.direct = probeHttp({
          url: `https://${ips[0]}/`,
          insecure: true,
          timeoutSec: 8,
        });
        layers.waf = probeWafHosts({
          wafIps: ips,
          hostHeader: host !== "localhost" ? host : ips[0],
          path: endpoints.path || "/",
        });
      } else {
        layers.direct = { ok: null, skipped: true, detail: "no edge ips" };
        layers.waf = { ok: null, skipped: true, detail: "no edge ips" };
      }
      layers.public =
        endpoints.public_url || (host && host !== "localhost")
          ? probeHttp({
              url: endpoints.public_url || `https://${host}/`,
              insecure: true,
            })
          : { ok: null, skipped: true, detail: "no public url" };
      layers.guest = probeGuest({
        repoRoot: root,
        family: "docker-qemu",
        guestIp: inst.guest_ip,
        port: inst.port || 80,
        path: "/",
        vmid: inst.vmid,
        hostId: inst.host_id,
        mode: inst.mode,
      });
    } else {
      const host = inst.hostname || endpoints.hostname;
      const path = inst.path || endpoints.path || "/";
      layers.dns = await probeDns(host || "");
      if (inst.public_url || endpoints.public_url) {
        const base = inst.public_url || endpoints.public_url;
        layers.public = probeHttp({
          url: joinUrlPath(/** @type {string} */ (base), path),
          insecure: true,
        });
      } else {
        layers.public = { ok: null, skipped: true, detail: "no public url" };
      }
      const hostHeader = host || (endpoints.public_url ? hostnameFromUrl(endpoints.public_url) : null);
      if (endpoints.waf_ips.length && hostHeader) {
        layers.waf = probeWafHosts({
          wafIps: endpoints.waf_ips,
          hostHeader,
          path,
        });
      } else {
        layers.waf = {
          ok: null,
          skipped: true,
          detail: !endpoints.waf_ips.length ? "no waf ips" : "no host header",
        };
      }
      if (inst.guest_ip) {
        const scheme = inst.port === 443 ? "https" : "http";
        layers.direct = probeHttp({
          url: `${scheme}://${inst.guest_ip}:${inst.port}${path}`,
          insecure: true,
        });
      } else {
        layers.direct = { ok: null, skipped: true, detail: "no guest ip" };
      }
      layers.guest = probeGuest({
        repoRoot: root,
        family,
        guestIp: inst.guest_ip,
        port: inst.port,
        path,
        vmid: inst.vmid,
        hostId: inst.host_id,
        mode: inst.mode,
      });
    }

    const status = deriveHealthStatus(
      /** @type {Record<string, { ok?: boolean|null, skipped?: boolean }>} */ (layers),
    );
    statuses.push(status);
    instancesOut.push({
      id: inst.id,
      system_id: inst.system_id,
      status,
      ok: statusIsOk(status),
      guest_ip: inst.guest_ip,
      port: inst.port,
      public_url: inst.public_url || endpoints.public_url,
      hostname: inst.hostname || endpoints.hostname,
      layers,
    });
  }

  let overall = "unknown";
  if (statuses.includes("down")) overall = "down";
  else if (statuses.includes("degraded")) overall = "degraded";
  else if (statuses.includes("healthy")) overall = "healthy";
  else if (!statuses.length) overall = "unknown";

  const payload = {
    ok: statusIsOk(overall),
    status: overall,
    target: packageId,
    verb: "health",
    family,
    config_loaded: endpoints.config_loaded,
    waf_ips: endpoints.waf_ips,
    instances: instancesOut,
    generated_at: new Date().toISOString(),
  };

  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  return payload;
}

/**
 * Convenience: clumpRoot from health/run.mjs meta url.
 * @param {string} importMetaUrl
 */
export function clumpRootFromHealthScript(importMetaUrl) {
  return join(dirname(fileURLToPath(importMetaUrl)), "..");
}
