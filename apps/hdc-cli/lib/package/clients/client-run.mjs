import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { stderr as errout } from "node:process";

import { parseArgvFlags } from "../parse-argv-flags.mjs";
import { runOperationReportTail } from "../operation-report.mjs";
import { repoRoot } from "../../paths.mjs";
import { createVaultAccess, vaultDepsFromCli } from "../../vault-access.mjs";
import { queryLinuxDisk, queryLinuxRebootRequired, queryLinuxUpgradableCount } from "./client-disk-linux.mjs";
import { maintainLinuxHost } from "./client-maintain-linux.mjs";
import { queryWindowsDisk } from "./client-disk-windows.mjs";
import { maintainWindowsHost, queryWindowsPendingUpdates, queryWindowsRebootRequired } from "./client-maintain-windows.mjs";
import {
  ensureWindowsOllamaViaMeshcentral,
  pullWindowsOllamaModelsViaMeshcentral,
  queryWindowsOllamaViaMeshcentral,
  startWindowsOllamaViaMeshcentral,
} from "./client-ollama-meshcentral.mjs";
import {
  ensureWindowsOllama,
  hostOllamaEnabled,
  pullWindowsOllamaModels,
  queryWindowsOllama,
  resolveHostOllamaOpts,
  startWindowsOllama,
} from "./client-ollama-windows.mjs";
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
import { isHostOnline, isWindowsHostOnline, tcpReachability } from "./client-reachability.mjs";
import { sendWakeOnLan, waitForReachable } from "./client-wol.mjs";

const SERVICE_PORT = { windows: 5986, ubuntu: 22, raspberrypi: 22 };

/**
 * @param {object} opts
 * @param {string} opts.platform
 * @param {string} opts.verb
 * @param {string} opts.id
 * @param {Record<string, unknown>} opts.host
 * @param {boolean} opts.dryRun
 * @param {"ensure"|"start"|"models"} [opts.mode]
 * @param {(msg: string) => void} opts.log
 */
async function runWindowsOllamaMeshcentralFallback(opts) {
  const { platform, verb, id, host, dryRun, mode = "ensure", log } = opts;
  try {
    if (mode === "start") {
      return await startWindowsOllamaViaMeshcentral({ hostId: id, host, log });
    }
    if (mode === "models") {
      return await pullWindowsOllamaModelsViaMeshcentral({ hostId: id, host, dryRun, log });
    }
    if (verb === "query") {
      return await queryWindowsOllamaViaMeshcentral({ hostId: id, host, log });
    }
    return await ensureWindowsOllamaViaMeshcentral({ hostId: id, host, dryRun, log });
  } catch (e) {
    return {
      ok: false,
      via: "meshcentral",
      message: String(/** @type {Error} */ (e).message || e),
    };
  }
}

/**
 * @param {object} opts
 * @param {string} opts.platform
 * @param {string} opts.verb
 * @param {string} opts.clumpRoot
 * @param {string[]} opts.argv
 */
export async function runClientVerb(opts) {
  const { platform, verb, clumpRoot, argv } = opts;
  const root = repoRoot();
  const flags = parseArgvFlags(argv);
  const hostIdFilter = flags["host-id"];
  const dryRun = flags["dry-run"] !== undefined;
  const skipUpdates = flags["skip-updates"] !== undefined;
  const reboot = flags["reboot"] !== undefined;
  const skipMailRelay = flags["skip-mail-relay"] !== undefined;
  const skipOllama = flags["skip-ollama"] !== undefined;
  const ollamaOnly = flags["ollama-only"] !== undefined;
  const ollamaStart = flags["ollama-start"] !== undefined;
  const ollamaModelsOnly = flags["ollama-models-only"] !== undefined;
  const ollamaScoped = ollamaOnly || ollamaStart || ollamaModelsOnly;
  const noWol = flags["no-wol"] !== undefined;
  const noWinrmBootstrap = flags["no-winrm-bootstrap"] !== undefined;
  const noReport = flags["no-report"] !== undefined;
  const reportPath = flags.report;

  errout.write(`[hdc] ${platform} ${verb}: home client ${verb} (stderr log; JSON on stdout).\n`);

  /** @type {Record<string, unknown>[]} */
  let hostResults = [];
  let ok = true;

  try {
    const cfg = loadClientConfigFromPackageRoot(clumpRoot);
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

      const online =
        platform === "windows" ? await isWindowsHostOnline(node.ip) : await isHostOnline(node.ip, port);
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
        if (platform === "windows" && ollamaScoped && hostOllamaEnabled(host) && !skipOllama) {
          errout.write(
            `[hdc] ${platform} ${verb}: host ${id} unreachable via LAN; trying MeshCentral agent…\n`,
          );
          const mode = ollamaStart ? "start" : ollamaModelsOnly ? "models" : "ensure";
          const ollama = await runWindowsOllamaMeshcentralFallback({
            platform,
            verb,
            id,
            host,
            dryRun,
            mode,
            log: (m) => errout.write(`[hdc] ${platform} ${verb}: host ${id} ${m}\n`),
          });
          row.reachability = "meshcentral";
          row.ollama = ollama;
          row.ok = ollama.ok === true;
          if (!row.ok) {
            row.message = typeof ollama.message === "string" ? ollama.message : "ollama via MeshCentral failed";
            ok = false;
          }
          hostResults.push(row);
          continue;
        }
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
          if (ollamaScoped && hostOllamaEnabled(host) && !skipOllama) {
            errout.write(
              `[hdc] ${platform} ${verb}: host ${id} WinRM unreachable; trying MeshCentral agent…\n`,
            );
            const mode = ollamaStart ? "start" : ollamaModelsOnly ? "models" : "ensure";
            const ollama = await runWindowsOllamaMeshcentralFallback({
              platform,
              verb,
              id,
              host,
              dryRun,
              mode,
              log: (m) => errout.write(`[hdc] ${platform} ${verb}: host ${id} ${m}\n`),
            });
            row.reachability = row.reachability ?? "online";
            row.ollama = ollama;
            row.ok = ollama.ok === true;
            if (!row.ok) {
              row.message =
                typeof ollama.message === "string" ? ollama.message : "ollama via MeshCentral failed";
              ok = false;
            }
            hostResults.push(row);
            continue;
          }
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

        const ollamaOpts = resolveHostOllamaOpts(host);
        const runOllama = hostOllamaEnabled(host) && !skipOllama;

        if (verb === "query") {
          if (!ollamaScoped) {
            const pending = queryWindowsPendingUpdates(conn);
            const reboot = queryWindowsRebootRequired(conn);
            row.updates = pending;
            row.reboot_required = reboot.ok ? reboot.reboot_required === true : null;
            row.ok = pending.ok && reboot.ok;
            if (!pending.ok || !reboot.ok) ok = false;
          } else {
            row.ok = true;
          }
          if (runOllama) {
            errout.write(`[hdc] ${platform} ${verb}: host ${id} Ollama status…\n`);
            const ollama = queryWindowsOllama(conn, ollamaOpts, (m) =>
              errout.write(`[hdc] ${platform} ${verb}: host ${id} ${m}\n`),
            );
            row.ollama = ollama;
            if (!ollama.ok) {
              row.ok = false;
              ok = false;
            }
          } else if (ollamaScoped) {
            row.ok = false;
            row.message = "ollama.enabled is not true for this host";
            ok = false;
          }
        } else {
          if (!ollamaScoped) {
            const maintain = maintainWindowsHost({
              conn,
              skipUpdates: skipUpdates || !hostUpdatesEnabled(host),
              reboot,
              dryRun,
            });
            row.maintain = maintain;
            row.ok = maintain.ok;
            if (!maintain.ok) ok = false;
          } else {
            row.ok = true;
            row.maintain = {
              ok: true,
              skipped: true,
              reason: ollamaStart
                ? "ollama-start"
                : ollamaModelsOnly
                  ? "ollama-models-only"
                  : "ollama-only",
            };
          }
          if (runOllama) {
            const log = (m) => errout.write(`[hdc] ${platform} ${verb}: host ${id} ${m}\n`);
            /** @type {{ ok: boolean; message?: string; [k: string]: unknown }} */
            let ollama;
            if (ollamaStart) {
              errout.write(`[hdc] ${platform} ${verb}: host ${id} start Ollama service…\n`);
              ollama = startWindowsOllama(conn, ollamaOpts, log);
            } else if (ollamaModelsOnly) {
              errout.write(`[hdc] ${platform} ${verb}: host ${id} pull Ollama models…\n`);
              ollama = pullWindowsOllamaModels(conn, ollamaOpts, { dryRun, log });
            } else {
              errout.write(`[hdc] ${platform} ${verb}: host ${id} ensure Ollama service…\n`);
              ollama = ensureWindowsOllama(conn, {
                ollama: ollamaOpts,
                dryRun,
                skipModels: false,
                log,
              });
            }
            row.ollama = ollama;
            if (!ollama.ok) {
              row.ok = false;
              ok = false;
            }
          } else if (ollamaScoped) {
            row.ok = false;
            row.message = "ollama.enabled is not true for this host";
            ok = false;
          }
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
          const reboot = queryLinuxRebootRequired(target, spawnSync, process.env);
          row.updates = up;
          row.upgradable_count = up.upgradable_count;
          row.reboot_required = reboot.ok ? reboot.reboot_required === true : null;
          row.ok = up.ok && reboot.ok;
          if (!up.ok || !reboot.ok) ok = false;
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
        clumpRoot,
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
      clumpRoot,
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
              `- **${h.id}** (${h.ip}): ${h.ok ? "ok" : "failed"}${h.message ? ` — ${h.message}` : ""}${
                h.ollama && typeof h.ollama === "object"
                  ? ` (ollama: ${/** @type {{ ok?: boolean }} */ (h.ollama).ok ? "ok" : "failed"})`
                  : ""
              }`,
          ),
        ];
      },
      reportPathArg: reportPath,
    });
    if (reportRel) errout.write(`[hdc] report: ${reportRel}\n`);
  }

  process.exitCode = ok ? 0 : 1;
}
