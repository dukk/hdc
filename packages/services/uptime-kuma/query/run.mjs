#!/usr/bin/env node
/**
 * Query Uptime Kuma instance status and monitor drift.
 *
 * Usage: hdc run service uptime-kuma query -- [--instance a | --system-id uptime-kuma-a]
 *        hdc run service uptime-kuma query -- [--live] [--import] [--import-from-homepage] [--yes]
 */
import { createInterface } from "node:readline/promises";
import { basename, dirname, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stdin as input, stderr as errout } from "node:process";

import { parseArgvFlags } from "../../../lib/parse-argv-flags.mjs";
import { repoRoot } from "../../../../tools/hdc/paths.mjs";
import { resolveUptimeKumaDeployments } from "../lib/deployments.mjs";
import { readCtPrimaryIp, resolvePveSshForHost } from "../lib/uptime-kuma-install.mjs";
import { queryUptimeKumaInCt } from "../lib/uptime-kuma-query.mjs";
import { loadPackageConfigFromPackageRoot } from "../../../lib/package-run-config.mjs";
import { normalizeUptimeKumaMonitorConfig } from "../lib/uptime-kuma-config.mjs";
import { collectUptimeKumaMonitorState, fetchLiveUptimeKumaMonitors } from "../lib/uptime-kuma-collect.mjs";
import {
  importHomepageMonitorsToConfig,
  importUptimeKumaMonitorsToConfig,
} from "../lib/uptime-kuma-import.mjs";
import { createUptimeKumaClientFromConfig } from "../lib/uptime-kuma-monitor-sync-runner.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, "..");
const PACKAGE_CONFIG_EXAMPLE = "packages/services/uptime-kuma/config.example.json";
/** @type {{ data: Record<string, unknown>; path: string; source: string } | null} */
let _pkgConfig = null;
function ensurePackageConfig() {
  if (!_pkgConfig) {
    _pkgConfig = loadPackageConfigFromPackageRoot(packageRoot, { exampleRel: PACKAGE_CONFIG_EXAMPLE });
  }
  return _pkgConfig;
}

const target = basename(dirname(here));
const verb = basename(here);
const root = repoRoot();
const proxmoxRoot = join(root, "packages", "infrastructure", "proxmox");

/** @param {unknown} v */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function readCfg(forceReload = false) {
  if (forceReload) _pkgConfig = null;
  return ensurePackageConfig().data;
}

/**
 * @param {string} rootDir
 * @param {string} systemId
 */
function loadManualSystemSidecar(rootDir, systemId) {
  const path = join(rootDir, "inventory", "manual", "systems", `${systemId}.json`);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/**
 * @param {unknown} sidecar
 */
function primaryIpFromSystem(sidecar) {
  if (!isObject(sidecar)) return null;
  const access = isObject(sidecar.access) ? sidecar.access : {};
  const nodes = Array.isArray(access.nodes) ? access.nodes : [];
  for (const n of nodes) {
    if (!isObject(n)) continue;
    const ip = typeof n.ip === "string" ? n.ip.trim() : "";
    if (ip) return ip;
  }
  return null;
}

/**
 * @param {string} question
 */
async function confirm(question) {
  const rl = createInterface({ input, output: errout });
  try {
    const answer = await rl.question(question);
    return /^y(es)?$/i.test(String(answer).trim());
  } finally {
    rl.close();
  }
}

/**
 * @param {ReturnType<typeof resolveUptimeKumaDeployments>[number]} deployment
 */
async function queryOne(deployment) {
  const { systemId, proxmox: px, uptimeKuma } = deployment;
  if (!isObject(px)) {
    return { ok: false, system_id: systemId, message: "bad proxmox config" };
  }
  const hostId = typeof px.host_id === "string" ? px.host_id.trim() : "";
  const lxc = isObject(px.lxc) ? px.lxc : {};
  const vmid = typeof lxc.vmid === "number" ? lxc.vmid : Number(lxc.vmid);
  if (!hostId || !Number.isFinite(vmid) || vmid <= 0) {
    return { ok: false, system_id: systemId, message: "missing host_id or vmid" };
  }

  errout.write(`[hdc] ${target} ${verb}: ${systemId} on ${hostId} vmid ${vmid} …\n`);
  const pveSsh = resolvePveSshForHost(proxmoxRoot, hostId);
  const sidecar = loadManualSystemSidecar(root, systemId);
  let ip = primaryIpFromSystem(sidecar);
  if (!ip) {
    ip = readCtPrimaryIp(pveSsh.user, pveSsh.host, vmid);
  }

  const ukCfg = isObject(uptimeKuma) ? uptimeKuma : {};
  const port =
    typeof ukCfg.port === "number" && Number.isFinite(ukCfg.port)
      ? ukCfg.port
      : Number(ukCfg.port) || 3001;

  const status = queryUptimeKumaInCt(pveSsh.user, pveSsh.host, vmid, port);
  return {
    system_id: systemId,
    host_id: hostId,
    vmid,
    ip,
    url: ip ? `http://${ip}:${port}` : null,
    ok: status.ok,
    status,
  };
}

async function main() {
  errout.write(`[hdc] ${target} ${verb}: Uptime Kuma status (stderr log; JSON on stdout).\n`);

  if (!existsSync(ensurePackageConfig().path)) {
    errout.write(`[hdc] ${target} ${verb}: missing packages/services/uptime-kuma/config.json\n`);
    process.stdout.write(
      `${JSON.stringify({ ok: false, target, verb, message: "package config missing" }, null, 2)}\n`,
    );
    process.exitCode = 1;
    return;
  }

  const flags = parseArgvFlags(process.argv.slice(2));
  const liveFlag = flags.live === "1";
  const doImport = flags.import === "1";
  const importHomepage = flags["import-from-homepage"] === "1";
  const yes = flags.yes === "1";

  let cfg = readCfg();

  if (importHomepage) {
    errout.write("[hdc] uptime-kuma query: import monitors from homepage/services.yaml …\n");
    if (!yes) {
      const ok = await confirm("Merge monitors[] from homepage services.yaml into config? [y/N] ");
      if (!ok) {
        errout.write("[hdc] uptime-kuma query: aborted (use --yes to skip prompt).\n");
        process.exitCode = 1;
        return;
      }
    }
    importHomepageMonitorsToConfig({
      packageRoot,
      repoRoot: root,
      log: (line) => errout.write(`[hdc] uptime-kuma query: ${line}\n`),
    });
    cfg = readCfg(true);
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          target,
          verb,
          import_from_homepage: true,
          monitor_count: normalizeUptimeKumaMonitorConfig(cfg).monitors.length,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  const monitorCfg = normalizeUptimeKumaMonitorConfig(cfg);
  /** @type {Record<string, unknown> | null} */
  let monitorState = null;
  /** @type {Record<string, unknown> | null} */
  let importResult = null;

  if (doImport || liveFlag || monitorCfg.monitors.length > 0) {
    try {
      const { client } = await createUptimeKumaClientFromConfig({
        packageRoot,
        cfgRaw: cfg,
        log: (line) => errout.write(`[hdc] ${target} ${verb}: ${line}\n`),
      });
      try {
        const liveMonitors = await fetchLiveUptimeKumaMonitors(client, (line) =>
          errout.write(`[hdc] ${target} ${verb}: ${line}\n`),
        );

        if (doImport) {
          if (!yes) {
            const ok = await confirm(
              `Replace monitors[] with ${liveMonitors.monitors.length} live monitor(s)? [y/N] `,
            );
            if (!ok) {
              errout.write("[hdc] uptime-kuma query: aborted (use --yes to skip prompt).\n");
              process.exitCode = 1;
              return;
            }
          }
          importResult = importUptimeKumaMonitorsToConfig({
            packageRoot,
            live: liveMonitors,
            log: (line) => errout.write(`[hdc] ${target} ${verb}: ${line}\n`),
          });
          cfg = readCfg(true);
        }

        const updatedMonitorCfg = normalizeUptimeKumaMonitorConfig(cfg);
        monitorState = collectUptimeKumaMonitorState(updatedMonitorCfg, liveMonitors);

        if (liveFlag) {
          process.stdout.write(
            `${JSON.stringify(
              {
                ok: true,
                target,
                verb,
                live: true,
                live_monitor_count: liveMonitors.monitors.length,
                monitors: liveMonitors.monitors.map((m) => ({
                  id: m.id,
                  uptime_kuma_id: m.uptime_kuma_id,
                  name: m.name,
                  type: m.type,
                  url: m.url,
                  hostname: m.hostname,
                })),
                monitor_drift: monitorState,
                import: importResult,
              },
              null,
              2,
            )}\n`,
          );
          process.exitCode = monitorState.has_drift && !doImport ? 1 : 0;
          return;
        }
      } finally {
        await client.disconnect();
      }
    } catch (e) {
      const msg = String(/** @type {Error} */ (e).message || e);
      errout.write(`[hdc] ${target} ${verb}: monitor API unavailable: ${msg}\n`);
      if (doImport || liveFlag) {
        process.stdout.write(
          `${JSON.stringify({ ok: false, target, verb, message: msg }, null, 2)}\n`,
        );
        process.exitCode = 1;
        return;
      }
    }
  }

  let deployments;
  try {
    deployments = resolveUptimeKumaDeployments(cfg, flags, { skipInstall: true });
  } catch (e) {
    errout.write(`[hdc] ${target} ${verb}: ${/** @type {Error} */ (e).message}\n`);
    process.stdout.write(
      `${JSON.stringify({ ok: false, target, verb, message: String(/** @type {Error} */ (e).message || e) }, null, 2)}\n`,
    );
    process.exitCode = 1;
    return;
  }

  /** @type {Record<string, unknown>[]} */
  const instances = [];
  for (const deployment of deployments) {
    try {
      instances.push(await queryOne(deployment));
    } catch (e) {
      const msg = String(/** @type {Error} */ (e).message || e);
      errout.write(`[hdc] ${target} ${verb}: ${deployment.systemId} failed: ${msg}\n`);
      instances.push({ ok: false, system_id: deployment.systemId, message: msg });
    }
  }

  const guestOk = instances.every((r) => r.ok);
  const drift = monitorState?.has_drift === true;
  const ok = guestOk && !drift;

  process.stdout.write(
    `${JSON.stringify(
      {
        ok,
        target,
        verb,
        generated_at: new Date().toISOString(),
        count: instances.length,
        instances,
        monitor_count: monitorCfg.monitors.length,
        managed_monitor_count: monitorCfg.monitors.filter((m) => m.managed).length,
        monitor_drift: monitorState,
        import: importResult,
      },
      null,
      2,
    )}\n`,
  );
  process.exitCode = ok ? 0 : 1;
}

main().catch((e) => {
  errout.write(`[hdc] ${target} ${verb}: fatal: ${/** @type {Error} */ (e).stack || e}\n`);
  process.stdout.write(
    `${JSON.stringify({ ok: false, target, verb, message: String(/** @type {Error} */ (e).message || e) }, null, 2)}\n`,
  );
  process.exitCode = 1;
});
