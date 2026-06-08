import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { stderr as errout } from "node:process";

import { parseArgvFlags } from "../../lib/parse-argv-flags.mjs";
import { runOperationReportTail } from "../../lib/operation-report.mjs";
import { repoRoot } from "../../../tools/hdc/paths.mjs";
import { createVaultAccess, vaultDepsFromCli } from "../../../tools/hdc/lib/vault-access.mjs";
import { queryLinuxDisk, queryLinuxUpgradableCount } from "./client-disk-linux.mjs";
import { maintainLinuxHost } from "./client-maintain-linux.mjs";
import { queryWindowsDisk } from "./client-disk-windows.mjs";
import { maintainWindowsHost, queryWindowsPendingUpdates } from "./client-maintain-windows.mjs";
import {
  hostUpdatesEnabled,
  hostWolEnabled,
  hostsForPlatform,
  loadClientConfigFromPackageRoot,
  primaryNodeFromHost,
  resolveHostMac,
  wolDefaultsFromConfig,
  mailRelayDefaultsFromConfig,
  hostMailRelayEnabled,
} from "./client-config.mjs";
import {
  ensureWinRmViaPsExec,
  winrmBootstrapDefaultsFromConfig,
} from "./client-winrm-bootstrap.mjs";
import { isHostOnline, tcpReachability } from "./client-reachability.mjs";
import { sendWakeOnLan, waitForReachable } from "./client-wol.mjs";

const SERVICE_PORT = { windows: 5986, ubuntu: 22, raspberrypi: 22 };

/**
 * @param {object} opts
 * @param {string} opts.platform
 * @param {string} opts.verb
 * @param {string} opts.packageRoot
 * @param {string[]} opts.argv
 */
export async function runClientVerb(opts) {
  const { platform, verb, packageRoot, argv } = opts;
  const root = repoRoot();
  const flags = parseArgvFlags(argv);
  const hostIdFilter = flags["host-id"];
  const dryRun = flags["dry-run"] !== undefined;
  const skipUpdates = flags["skip-updates"] !== undefined;
  const reboot = flags["reboot"] !== undefined;
  const skipMailRelay = flags["skip-mail-relay"] !== undefined;
  const noWol = flags["no-wol"] !== undefined;
  const noWinrmBootstrap = flags["no-winrm-bootstrap"] !== undefined;
  const noReport = flags["no-report"] !== undefined;
  const reportPath = flags.report;

  errout.write(`[hdc] ${platform} ${verb}: home client ${verb} (stderr log; JSON on stdout).\n`);

  /** @type {Record<string, unknown>[]} */
  let hostResults = [];
  let ok = true;

  try {
    const cfg = loadClientConfigFromPackageRoot(packageRoot);
    const wolDefaults = wolDefaultsFromConfig(cfg);
    const mailRelayDefaults = mailRelayDefaultsFromConfig(cfg);
    const winrmBootstrapDefaults = winrmBootstrapDefaultsFromConfig(cfg);
    const hosts = hostsForPlatform(cfg, platform, hostIdFilter);
    if (!hosts.length) {
      throw new Error(
        hostIdFilter
          ? `no enabled hosts for platform ${platform} with id ${hostIdFilter}`
          : `no enabled hosts for platform ${platform} in config.json`,
      );
    }

    const port = SERVICE_PORT[/** @type {keyof SERVICE_PORT} */ (platform)] ?? 22;
    const vault = createVaultAccess(vaultDepsFromCli({ env: process.env }));

    for (const host of hosts) {
      const id = String(host.id ?? "");
      errout.write(`[hdc] ${platform} ${verb}: host ${id} …\n`);
      const node = primaryNodeFromHost(host, process.env);
      if (!node?.ip) {
        hostResults.push({ id, ok: false, message: "missing access.nodes[].ip" });
        ok = false;
        continue;
      }

      /** @type {Record<string, unknown>} */
      const row = { id, ip: node.ip, platform };

      const online = await isHostOnline(node.ip, port);
      row.reachability = online ? "online" : "offline";

      if (!online && !noWol && hostWolEnabled(host, wolDefaults)) {
        const mac = resolveHostMac(host, root);
        if (!mac) {
          row.wol = { attempted: false, error: "no MAC configured" };
          row.ok = false;
          row.message = "offline and no MAC for WoL";
          hostResults.push(row);
          ok = false;
          continue;
        }
        if (dryRun) {
          errout.write(`[hdc] dry-run: would send WoL to ${mac} via ${wolDefaults.broadcast}\n`);
          row.wol = { attempted: true, dry_run: true, mac };
        } else {
          errout.write(`[hdc] sending WoL to ${mac} via ${wolDefaults.broadcast} …\n`);
          await sendWakeOnLan({
            mac,
            broadcast: wolDefaults.broadcast,
            port: wolDefaults.port,
            packets: wolDefaults.packets,
          });
          row.wol = { attempted: true, mac };
          const woke = await waitForReachable({
            host: node.ip,
            port,
            waitSeconds: wolDefaults.waitSeconds,
            pollIntervalSeconds: wolDefaults.pollIntervalSeconds,
            log: (m) => errout.write(`[hdc] ${m}\n`),
          });
          if (!woke) {
            row.wol = { .../** @type {object} */ (row.wol), timed_out: true };
            row.ok = false;
            row.message = "WoL sent but host did not become reachable";
            hostResults.push(row);
            ok = false;
            continue;
          }
          row.reachability = "online_after_wol";
        }
      } else if (!online) {
        row.ok = false;
        row.message = noWol ? "host offline (--no-wol)" : "host offline";
        hostResults.push(row);
        ok = false;
        continue;
      }

      if (platform === "windows") {
        const winrmPort = node.winrm.port;
        let winrmReachable = (await tcpReachability(node.ip, winrmPort)) === "open";
        if (!winrmReachable && !noWinrmBootstrap) {
          const boot = await ensureWinRmViaPsExec({
            host: node.ip,
            port: winrmPort,
            bootstrap: winrmBootstrapDefaults,
            env: process.env,
            dryRun,
            log: (m) => errout.write(`[hdc] ${m}\n`),
          });
          row.winrm_bootstrap = {
            attempted: boot.attempted ?? false,
            ok: boot.ok,
            message: boot.message,
            dry_run: boot.dry_run === true,
          };
          if (!boot.ok) {
            row.ok = false;
            row.message = boot.message ?? "WinRM bootstrap failed";
            hostResults.push(row);
            ok = false;
            continue;
          }
          winrmReachable = boot.dry_run === true || (await tcpReachability(node.ip, winrmPort)) === "open";
        }
        if (!winrmReachable) {
          row.ok = false;
          row.message = noWinrmBootstrap
            ? `WinRM port ${winrmPort} not open (--no-winrm-bootstrap)`
            : `WinRM port ${winrmPort} not reachable`;
          hostResults.push(row);
          ok = false;
          continue;
        }

        if (!node.winrmUser) {
          row.ok = false;
          row.message = "WinRM user env not set";
          hostResults.push(row);
          ok = false;
          continue;
        }
        let password = "";
        try {
          password = (await vault.getSecret(node.winrmVaultKey)) ?? "";
        } catch (e) {
          row.ok = false;
          row.message = `vault: ${/** @type {Error} */ (e).message}`;
          hostResults.push(row);
          ok = false;
          continue;
        }
        if (!password) {
          row.ok = false;
          row.message = `missing vault secret ${node.winrmVaultKey}`;
          hostResults.push(row);
          ok = false;
          continue;
        }
        const conn = {
          computerName: node.ip,
          port: node.winrm.port,
          useSsl: node.winrm.useSsl,
          skipCaCheck: node.winrm.skipCaCheck,
          username: node.winrmUser,
          password,
        };
        const disk = queryWindowsDisk(conn);
        row.disk = disk;
        if (!disk.ok) {
          row.ok = false;
          row.message = disk.message;
          hostResults.push(row);
          ok = false;
          continue;
        }
        if (verb === "query") {
          const pending = queryWindowsPendingUpdates(conn);
          row.updates = pending;
          row.ok = pending.ok;
          if (!pending.ok) ok = false;
        } else {
          const maintain = maintainWindowsHost({
            conn,
            skipUpdates: skipUpdates || !hostUpdatesEnabled(host),
            reboot,
            dryRun,
          });
          row.maintain = maintain;
          row.ok = maintain.ok;
          if (!maintain.ok) ok = false;
        }
      } else {
        if (!node.sshUser) {
          row.ok = false;
          row.message = "SSH user not configured";
          hostResults.push(row);
          ok = false;
          continue;
        }
        const target = { user: node.sshUser, host: node.ip };
        const disk = queryLinuxDisk(target, spawnSync, process.env);
        row.disk = disk;
        if (!disk.ok) {
          row.ok = false;
          row.message = "disk query failed";
          hostResults.push(row);
          ok = false;
          continue;
        }
        if (verb === "query") {
          const up = queryLinuxUpgradableCount(target, spawnSync, process.env);
          row.updates = up;
          row.ok = up.ok;
          if (!up.ok) ok = false;
        } else {
          const maintain = await maintainLinuxHost({
            target,
            spawnSync,
            env: process.env,
            skipUpdates: skipUpdates || !hostUpdatesEnabled(host),
            reboot,
            dryRun,
            skipMailRelay,
            mailRelayEnabled: hostMailRelayEnabled(host, mailRelayDefaults),
            hostId: id,
            log: (m) => errout.write(`[hdc] ${m}\n`),
            warn: (m) => errout.write(`[hdc] warning: ${m}\n`),
          });
          row.maintain = maintain;
          row.ok = maintain.ok;
          if (!maintain.ok) ok = false;
        }
      }

      if (row.ok === undefined) row.ok = true;
      hostResults.push(row);
    }
  } catch (e) {
    ok = false;
    const message = /** @type {Error} */ (e).message;
    errout.write(`[hdc] ${platform} ${verb}: ${message}\n`);
    const payload = { ok: false, package: platform, verb, message, hosts: hostResults };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    if (!noReport) {
      runOperationReportTail({
        packageRoot,
        repoRoot: root,
        verb,
        argv,
        ok: false,
        payload,
        log: (line) => errout.write(`${line}\n`),
      });
    }
    process.exitCode = 1;
    return;
  }

  const payload = { ok, package: platform, verb, hosts: hostResults };
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);

  if (!noReport) {
    const reportRel = runOperationReportTail({
      packageRoot,
      repoRoot: root,
      verb,
      argv,
      ok,
      payload,
      log: (line) => errout.write(`${line}\n`),
      extraSections: (ctx) => {
        void ctx;
        return [
          "## Hosts",
          "",
          ...hostResults.map(
            (h) =>
              `- **${h.id}** (${h.ip}): ${h.ok ? "ok" : "failed"}${h.message ? ` — ${h.message}` : ""}`,
          ),
        ];
      },
      reportPathArg: reportPath,
    });
    if (reportRel) errout.write(`[hdc] report: ${reportRel}\n`);
  }

  process.exitCode = ok ? 0 : 1;
}
