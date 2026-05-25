#!/usr/bin/env node
/**
 * Proxmox maintain:
 * 1. Install local SSH public keys on each hypervisor (password from vault if needed).
 * 2. Ensure hdc API token role/ACL (VM.Audit, Datastore.Audit, …) via pveum over SSH.
 * 3. Verify provision templates (LXC ostemplate on each node; QEMU template_vmid in cluster).
 * 4. Ensure NAS storage connections (nas-1, nas-2 by default) on each cluster/standalone group.
 * 5. apt update/dist-upgrade on each hypervisor via SSH public-key auth; sequential reboot if required.
 * 6. Ensure local `hdc` user on bootstrap hosts (see `users bootstrap-hdc`).
 * 7. Report configured CPU/RAM/disk load per hypervisor (% of node capacity from API).
 * 8. Write markdown report under packages/infrastructure/proxmox/reports/ (unless --no-report).
 *
 * Flags (forwarded to bootstrap-hdc where applicable):
 *   --dry-run              Report only; no SSH password changes or template downloads
 *   --no-download          Do not auto-download missing LXC ostemplates
 *   --no-build-qemu        Do not build missing QEMU templates from cloud images
 *   --no-prune             Do not remove unsupported Ubuntu LXC/QEMU templates
 *   --skip-storage           Skip NAS storage ensure (nas-1, nas-2)
 *   --skip-api-token         Skip hdc API token role/ACL ensure (pveum over SSH)
 *   --skip-ssh-keys          Skip installing local SSH keys on hypervisors
 *   --skip-os-updates      Skip apt update/upgrade and reboots on hypervisors
 *   --skip-load-report     Skip configured CPU/RAM/disk load report (stderr); markdown may still collect capacity
 *   --no-report            Do not write markdown report file
 *   --report <path>        Override markdown report output path
 *   --skip-bootstrap         Only check templates
 *   --skip-templates         Only run bootstrap-hdc
 *   --sidecar <path>         Limit bootstrap to JSON sidecar(s)
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { stderr as errout } from "node:process";
import { fileURLToPath } from "node:url";

import { createNodeCliDeps } from "../../../../tools/hdc/lib/node-cli-deps.mjs";
import { CliExit } from "../../../../tools/hdc/lib/cli-exit.mjs";
import {
  bootstrapHostDocsFromInfrastructureConfigs,
  runUsersBootstrapHdc,
} from "../../../../tools/hdc/lib/users-bootstrap-hdc.mjs";
import { createVaultAccess, vaultDepsFromCli } from "../../../../tools/hdc/lib/vault-access.mjs";
import {
  hostOsRebootWaitMsFromConfig,
  runProxmoxHostOsMaintain,
} from "../lib/proxmox-host-os-maintain.mjs";
import { runProxmoxMaintainTemplates } from "../lib/proxmox-maintain-templates.mjs";
import { runProxmoxApiTokenMaintain } from "../lib/proxmox-api-token-maintain.mjs";
import { runProxmoxStorageMaintain } from "../lib/proxmox-storage-maintain.mjs";
import { runProxmoxSshKeysMaintain } from "../lib/proxmox-ssh-keys-maintain.mjs";
import {
  collectProxmoxCapacityReport,
  runProxmoxHostLoadReport,
} from "../lib/proxmox-host-load-report.mjs";
import { isProxmoxConfigObject, isProxmoxHostDown } from "../lib/proxmox-config.mjs";
import {
  createMaintainReportContext,
  pushWarning,
  recordStep,
  writeMaintainReportFile,
} from "../lib/proxmox-maintain-report.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, "..");

/**
 * @param {string} line
 */
function log(line) {
  errout.write(`[proxmox] maintain: ${line}\n`);
}

/**
 * @param {string} line
 */
function warn(line) {
  errout.write(`[proxmox] maintain: WARN ${line}\n`);
}

/**
 * @param {string[]} argv
 */
function bootstrapArgv(argv) {
  return argv.filter((a) => a !== "--skip-bootstrap" && a !== "--skip-templates");
}

/**
 * @param {string} packageRoot
 * @returns {string[]}
 */
function downHostIdsFromConfig(packageRoot) {
  const cfgPath = join(packageRoot, "config.json");
  if (!existsSync(cfgPath)) return [];
  try {
    const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
    if (!isProxmoxConfigObject(cfg) || !Array.isArray(cfg.clusters)) return [];
    /** @type {string[]} */
    const ids = [];
    for (const cl of cfg.clusters) {
      if (!isProxmoxConfigObject(cl) || !Array.isArray(cl.hosts)) continue;
      for (const h of cl.hosts) {
        if (!isProxmoxConfigObject(h)) continue;
        const id = typeof h.id === "string" ? h.id.trim() : "";
        if (id && isProxmoxHostDown(h)) ids.push(id);
      }
    }
    return ids.sort();
  } catch {
    return [];
  }
}

/**
 * @param {string[]} argv
 * @returns {string | undefined}
 */
function reportPathFromArgv(argv) {
  const idx = argv.indexOf("--report");
  if (idx >= 0 && argv[idx + 1]) return argv[idx + 1];
  return undefined;
}

async function main() {
  const argv = process.argv.slice(2);
  const skipBootstrap = argv.includes("--skip-bootstrap");
  const skipTemplates = argv.includes("--skip-templates");
  const skipStorage = argv.includes("--skip-storage");
  const skipApiToken = argv.includes("--skip-api-token");
  const skipSshKeys = argv.includes("--skip-ssh-keys");
  const skipOsUpdates = argv.includes("--skip-os-updates");
  const skipLoadReport = argv.includes("--skip-load-report");
  const noReport = argv.includes("--no-report");
  const dryRun = argv.includes("--dry-run");
  const noDownload = argv.includes("--no-download");
  const noBuildQemu = argv.includes("--no-build-qemu");
  const noPrune = argv.includes("--no-prune");
  const reportPathArg = reportPathFromArgv(argv);

  const reportCtx = createMaintainReportContext(argv);
  reportCtx.downHosts = downHostIdsFromConfig(packageRoot);

  errout.write("[proxmox] maintain: starting (stderr log).\n");

  let exitCode = 0;
  const deps = createNodeCliDeps();
  const vault = createVaultAccess(vaultDepsFromCli(deps));

  const needsVault =
    !skipTemplates ||
    !skipStorage ||
    !skipSshKeys ||
    !skipApiToken ||
    !skipLoadReport ||
    !noReport;

  try {
    if (needsVault) {
      try {
        await vault.unlock({});
      } catch (e) {
        if (e instanceof CliExit) {
          exitCode = e.code;
          return;
        }
        throw e;
      }
    }

    if (!skipSshKeys) {
      try {
        const sshResult = await runProxmoxSshKeysMaintain({
          packageRoot,
          log,
          warn,
          vault,
          dryRun,
          env: deps.env,
          spawnSync: deps.spawnSync,
          readLineQuestion: deps.readLineQuestion,
        });
        if (!sshResult.ok) exitCode = 1;
        recordStep(reportCtx, {
          id: "ssh-keys",
          title: "SSH public keys",
          ran: true,
          ok: sshResult.ok,
        });
      } catch (e) {
        if (e instanceof CliExit) {
          exitCode = exitCode || e.code;
        } else {
          log(`SSH keys maintain fatal: ${/** @type {Error} */ (e).stack || e}`);
          exitCode = 1;
        }
        recordStep(reportCtx, {
          id: "ssh-keys",
          title: "SSH public keys",
          ran: true,
          ok: false,
          notes: [String(/** @type {Error} */ (e).message || e)],
        });
      }
    } else {
      recordStep(reportCtx, {
        id: "ssh-keys",
        title: "SSH public keys",
        ran: false,
        skipReason: "--skip-ssh-keys",
      });
    }

    if (!skipApiToken) {
      try {
        const tokenResult = await runProxmoxApiTokenMaintain({
          packageRoot,
          log,
          warn,
          vault,
          env: deps.env,
          spawnSync: deps.spawnSync,
          dryRun,
          readLineQuestion: deps.readLineQuestion,
          hostProbe: deps.hostProbe,
        });
        if (!tokenResult.ok) exitCode = 1;
        recordStep(reportCtx, {
          id: "api-token",
          title: "API token ACL",
          ran: true,
          ok: tokenResult.ok,
        });
      } catch (e) {
        if (e instanceof CliExit) {
          exitCode = exitCode || e.code;
        } else {
          log(`API token maintain fatal: ${/** @type {Error} */ (e).stack || e}`);
          exitCode = 1;
        }
        recordStep(reportCtx, {
          id: "api-token",
          title: "API token ACL",
          ran: true,
          ok: false,
          notes: [String(/** @type {Error} */ (e).message || e)],
        });
      }
    } else {
      recordStep(reportCtx, {
        id: "api-token",
        title: "API token ACL",
        ran: false,
        skipReason: "--skip-api-token",
      });
    }

    if (!skipTemplates) {
      try {
        const result = await runProxmoxMaintainTemplates({
          packageRoot,
          log,
          warn,
          vault,
          downloadMissing: !noDownload,
          buildQemuTemplate: !noBuildQemu,
          pruneUnsupported: !noPrune,
          dryRun,
        });
        if (!result.ok) exitCode = 1;
        reportCtx.templateChecks = result.checks ?? [];
        recordStep(reportCtx, {
          id: "templates",
          title: "Ubuntu LTS templates",
          ran: true,
          ok: result.ok,
          notes: [
            noDownload ? "no-download" : "",
            noBuildQemu ? "no-build-qemu" : "",
            noPrune ? "no-prune" : "",
          ].filter(Boolean),
        });
      } catch (e) {
        if (e instanceof CliExit) {
          exitCode = exitCode || e.code;
        } else {
          log(`template check fatal: ${/** @type {Error} */ (e).stack || e}`);
          exitCode = 1;
        }
        recordStep(reportCtx, {
          id: "templates",
          title: "Ubuntu LTS templates",
          ran: true,
          ok: false,
          notes: [String(/** @type {Error} */ (e).message || e)],
        });
      }
    } else {
      recordStep(reportCtx, {
        id: "templates",
        title: "Ubuntu LTS templates",
        ran: false,
        skipReason: "--skip-templates",
      });
    }

    if (!skipStorage) {
      try {
        const storageResult = await runProxmoxStorageMaintain({
          packageRoot,
          log,
          warn,
          vault,
          dryRun,
        });
        if (!storageResult.ok) exitCode = 1;
        recordStep(reportCtx, {
          id: "storage",
          title: "NAS storage ensure",
          ran: true,
          ok: storageResult.ok,
        });
      } catch (e) {
        if (e instanceof CliExit) {
          exitCode = exitCode || e.code;
        } else {
          log(`storage maintain fatal: ${/** @type {Error} */ (e).stack || e}`);
          exitCode = 1;
        }
        recordStep(reportCtx, {
          id: "storage",
          title: "NAS storage ensure",
          ran: true,
          ok: false,
          notes: [String(/** @type {Error} */ (e).message || e)],
        });
      }
    } else {
      recordStep(reportCtx, {
        id: "storage",
        title: "NAS storage ensure",
        ran: false,
        skipReason: "--skip-storage",
      });
    }

    if (!skipOsUpdates) {
      let rebootWaitMs = 5 * 60 * 1000;
      const cfgPath = join(packageRoot, "config.json");
      if (existsSync(cfgPath)) {
        try {
          rebootWaitMs = hostOsRebootWaitMsFromConfig(JSON.parse(readFileSync(cfgPath, "utf8")));
        } catch {
          /* use default */
        }
      }
      try {
        const osResult = await runProxmoxHostOsMaintain({
          packageRoot,
          log,
          warn,
          dryRun,
          env: deps.env,
          spawnSync: deps.spawnSync,
          rebootWaitMs,
        });
        if (!osResult.ok) exitCode = 1;
        recordStep(reportCtx, {
          id: "host-os",
          title: "Host OS updates",
          ran: true,
          ok: osResult.ok,
        });
      } catch (e) {
        log(`host OS maintain fatal: ${/** @type {Error} */ (e).stack || e}`);
        exitCode = 1;
        recordStep(reportCtx, {
          id: "host-os",
          title: "Host OS updates",
          ran: true,
          ok: false,
          notes: [String(/** @type {Error} */ (e).message || e)],
        });
      }
    } else {
      recordStep(reportCtx, {
        id: "host-os",
        title: "Host OS updates",
        ran: false,
        skipReason: "--skip-os-updates",
      });
    }

    if (!skipLoadReport) {
      try {
        const loadResult = await runProxmoxHostLoadReport({
          packageRoot,
          log,
          warn,
          vault,
        });
        if (loadResult.data) reportCtx.capacity = loadResult.data;
        if (!loadResult.ok) exitCode = 1;
        recordStep(reportCtx, {
          id: "load-report",
          title: "Configured load report (stderr)",
          ran: true,
          ok: loadResult.ok,
        });
      } catch (e) {
        if (e instanceof CliExit) {
          exitCode = exitCode || e.code;
        } else {
          log(`load report fatal: ${/** @type {Error} */ (e).stack || e}`);
          exitCode = 1;
        }
        recordStep(reportCtx, {
          id: "load-report",
          title: "Configured load report (stderr)",
          ran: true,
          ok: false,
          notes: [String(/** @type {Error} */ (e).message || e)],
        });
      }
    } else {
      recordStep(reportCtx, {
        id: "load-report",
        title: "Configured load report (stderr)",
        ran: false,
        skipReason: "--skip-load-report",
      });
    }

    if (!skipBootstrap) {
      const bootstrapHosts = bootstrapHostDocsFromInfrastructureConfigs(deps.repoRoot(), deps);
      if (!bootstrapHosts.length) {
        log("skip bootstrap-hdc (bootstrap_hosts is empty).");
        recordStep(reportCtx, {
          id: "bootstrap",
          title: "Bootstrap hdc user",
          ran: false,
          skipReason: "bootstrap_hosts empty",
        });
      } else {
        try {
          await runUsersBootstrapHdc(bootstrapArgv(argv), deps, { vault });
          recordStep(reportCtx, {
            id: "bootstrap",
            title: "Bootstrap hdc user",
            ran: true,
            ok: true,
          });
        } catch (e) {
          if (e instanceof CliExit) {
            exitCode = exitCode || e.code;
            recordStep(reportCtx, {
              id: "bootstrap",
              title: "Bootstrap hdc user",
              ran: true,
              ok: false,
              notes: [`exit ${e.code}`],
            });
          } else {
            console.error(e);
            exitCode = 1;
            recordStep(reportCtx, {
              id: "bootstrap",
              title: "Bootstrap hdc user",
              ran: true,
              ok: false,
              notes: [String(/** @type {Error} */ (e).message || e)],
            });
          }
        }
      }
    } else {
      recordStep(reportCtx, {
        id: "bootstrap",
        title: "Bootstrap hdc user",
        ran: false,
        skipReason: "--skip-bootstrap",
      });
    }
  } finally {
    reportCtx.exitCode = exitCode;

    if (!noReport) {
      if (!reportCtx.capacity) {
        try {
          reportCtx.capacity = await collectProxmoxCapacityReport({
            packageRoot,
            warn: (line) => pushWarning(reportCtx, line),
            vault,
          });
        } catch (e) {
          pushWarning(
            reportCtx,
            `Capacity collect for markdown failed: ${/** @type {Error} */ (e).message || e}`,
          );
        }
      }

      try {
        const written = writeMaintainReportFile({
          packageRoot,
          ctx: reportCtx,
          reportPathArg,
        });
        if (written) log(`Wrote maintain report to ${written}`);
      } catch (e) {
        warn(`Failed to write maintain report: ${/** @type {Error} */ (e).message || e}`);
      }
    }
  }

  if (exitCode === 0) log("finished OK.");
  else log("finished with errors.");
  process.exit(exitCode);
}

main();
