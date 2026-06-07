#!/usr/bin/env node
/**
 * Proxmox maintain:
 * 1. Install local SSH public keys on each hypervisor (password from vault if needed).
 * 2. Ensure hdc API token role/ACL (VM.Audit, Datastore.Audit, …) via pveum over SSH.
 * 3. Verify provision templates (LXC ostemplate on each node; QEMU template_vmid in cluster).
 * 4. Ensure NAS storage connections (nas-a, nas-b by default) on each cluster/standalone group.
 * 5. Extend local-lvm and ensure extra-disk LVM-thin pools (provision.local_lvm).
 * 6. apt update/dist-upgrade on each hypervisor via SSH public-key auth; sequential reboot if required.
 * 7. Report configured CPU/RAM/disk load per hypervisor (% of node capacity from API).
 * 8. Write markdown report under packages/infrastructure/proxmox/reports/ in hdc-private when present (unless --no-report).
 *
 * Bootstrap the local `hdc` user on Ubuntu/bootstrap hosts via `ubuntu maintain` or `users bootstrap-hdc` — not from this script.
 *
 * Flags:
 *   --dry-run              Report only; no SSH password changes or template downloads
 *   --no-download          Do not auto-download missing LXC ostemplates
 *   --no-build-qemu        Do not build missing QEMU templates from cloud images
 *   --no-prune             Do not remove unsupported Ubuntu LXC/QEMU templates
 *   --skip-storage           Skip NAS storage ensure (nas-a, nas-b)
 *   --skip-local-lvm         Skip local-lvm extend and extra-disk pools
 *   --skip-api-token         Skip hdc API token role/ACL ensure (pveum over SSH)
 *   --skip-ssh-keys          Skip installing local SSH keys on hypervisors
 *   --skip-os-updates      Skip apt update/upgrade and reboots on hypervisors
 *   --skip-load-report     Skip configured CPU/RAM/disk load report (stderr); markdown may still collect capacity
 *   --skip-oem-license     Skip OEM Windows SLIC/MSDM probe on hypervisors
 *   --skip-guest-agent     Skip QEMU guest agent config + ping report
 *   --skip-host-firewall   Skip Proxmox host firewall (SSH/8006 restriction)
 *   --skip-guest-firewall  Skip Proxmox guest firewall rules on managed vmids
 *   --skip-mail-relay      Skip Postfix satellite (internal mail relay) on hypervisors
 *   --no-report            Do not write markdown report file
 *   --report <path>        Override markdown report output path
 *   --skip-templates       Skip Ubuntu LTS template verify/build
 */
import { dirname, join } from "node:path";
import { loadPackageConfigFromPackageRoot } from "../../../lib/package-run-config.mjs";
import { stderr as errout } from "node:process";
import { fileURLToPath } from "node:url";

import { createNodeCliDeps } from "../../../../tools/hdc/lib/node-cli-deps.mjs";
import { CliExit } from "../../../../tools/hdc/lib/cli-exit.mjs";
import { repoRoot } from "../../../../tools/hdc/paths.mjs";
import { createVaultAccess, vaultDepsFromCli } from "../../../../tools/hdc/lib/vault-access.mjs";
import {
  hostOsRebootWaitMsFromConfig,
  runProxmoxHostOsMaintain,
} from "../lib/proxmox-host-os-maintain.mjs";
import { runProxmoxMailRelayMaintain } from "../lib/proxmox-mail-relay-maintain.mjs";
import { runProxmoxMaintainTemplates } from "../lib/proxmox-maintain-templates.mjs";
import { runProxmoxApiTokenMaintain } from "../lib/proxmox-api-token-maintain.mjs";
import { runProxmoxStorageMaintain } from "../lib/proxmox-storage-maintain.mjs";
import { runProxmoxLocalLvmMaintain } from "../lib/proxmox-local-lvm-maintain.mjs";
import { runProxmoxSshKeysMaintain } from "../lib/proxmox-ssh-keys-maintain.mjs";
import {
  collectProxmoxCapacityReport,
  runProxmoxHostLoadReport,
} from "../lib/proxmox-host-load-report.mjs";
import { runProxmoxOemWindowsLicenseReport } from "../lib/proxmox-oem-windows-license.mjs";
import { runProxmoxQemuGuestAgentReport } from "../lib/proxmox-qemu-guest-agent.mjs";
import { runProxmoxHostFirewallMaintain } from "../lib/proxmox-host-firewall-maintain.mjs";
import { runProxmoxGuestFirewallMaintain } from "../lib/proxmox-guest-firewall-maintain.mjs";
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
 * @param {string} packageRoot
 * @returns {string[]}
 */
function downHostIdsFromConfig(packageRoot) {
  try {
    const { data: cfg } = loadPackageConfigFromPackageRoot(packageRoot, {
      exampleRel: "packages/infrastructure/proxmox/config.example.json",
    });
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
  const skipTemplates = argv.includes("--skip-templates");
  const skipStorage = argv.includes("--skip-storage");
  const skipLocalLvm = argv.includes("--skip-local-lvm");
  const skipApiToken = argv.includes("--skip-api-token");
  const skipSshKeys = argv.includes("--skip-ssh-keys");
  const skipOsUpdates = argv.includes("--skip-os-updates");
  const skipLoadReport = argv.includes("--skip-load-report");
  const skipOemLicense = argv.includes("--skip-oem-license");
  const skipGuestAgent = argv.includes("--skip-guest-agent");
  const skipHostFirewall = argv.includes("--skip-host-firewall");
  const skipGuestFirewall = argv.includes("--skip-guest-firewall");
  const skipMailRelay = argv.includes("--skip-mail-relay");
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

    if (!skipLocalLvm) {
      try {
        const localLvmResult = await runProxmoxLocalLvmMaintain({
          packageRoot,
          log,
          warn,
          dryRun,
          env: deps.env,
          spawnSync: deps.spawnSync,
        });
        if (!localLvmResult.ok) exitCode = 1;
        /** @type {string[]} */
        const localLvmNotes = [];
        for (const row of localLvmResult.results ?? []) {
          const hostId = typeof row.hostId === "string" ? row.hostId : "?";
          if (row.skipped) {
            localLvmNotes.push(`${hostId}: skip`);
            continue;
          }
          if (row.error) {
            localLvmNotes.push(`${hostId}: ${row.error}`);
            continue;
          }
          /** @type {string[]} */
          const parts = [];
          if (row.extend && typeof row.extend === "object") {
            const ext = /** @type {{ ok?: boolean; skipped?: boolean }} */ (row.extend);
            if (ext.skipped) parts.push("extend:skip");
            else parts.push(`extend:${ext.ok ? "ok" : "fail"}`);
          }
          if (Array.isArray(row.pools)) {
            for (const p of row.pools) {
              if (!p || typeof p !== "object") continue;
              const po = /** @type {{ storageId?: string; ok?: boolean; dryRun?: boolean }} */ (p);
              const sid = po.storageId ?? "pool";
              if (po.dryRun) parts.push(`${sid}:dry-run`);
              else parts.push(`${sid}:${po.ok ? "ok" : "fail"}`);
            }
          }
          localLvmNotes.push(`${hostId}: ${parts.length ? parts.join("; ") : "ok"}`);
        }
        recordStep(reportCtx, {
          id: "local-lvm",
          title: "Local LVM extend and extra pools",
          ran: true,
          ok: localLvmResult.ok,
          notes: localLvmNotes,
        });
      } catch (e) {
        log(`local-lvm maintain fatal: ${/** @type {Error} */ (e).stack || e}`);
        exitCode = 1;
        recordStep(reportCtx, {
          id: "local-lvm",
          title: "Local LVM extend and extra pools",
          ran: true,
          ok: false,
          notes: [String(/** @type {Error} */ (e).message || e)],
        });
      }
    } else {
      recordStep(reportCtx, {
        id: "local-lvm",
        title: "Local LVM extend and extra pools",
        ran: false,
        skipReason: "--skip-local-lvm",
      });
    }

    if (!skipOsUpdates) {
      let rebootWaitMs = 5 * 60 * 1000;
      try {
        const { data: cfg } = loadPackageConfigFromPackageRoot(packageRoot, {
          exampleRel: "packages/infrastructure/proxmox/config.example.json",
        });
        rebootWaitMs = hostOsRebootWaitMsFromConfig(cfg);
      } catch {
        /* use default */
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

    if (!skipMailRelay) {
      try {
        const mailResult = await runProxmoxMailRelayMaintain({
          packageRoot,
          log,
          warn,
          dryRun,
          env: deps.env,
          spawnSync: deps.spawnSync,
        });
        reportCtx.mailRelay = mailResult.hosts ?? [];
        if (!mailResult.ok) exitCode = 1;
        recordStep(reportCtx, {
          id: "mail-relay",
          title: "Postfix satellite (mail relay)",
          ran: true,
          ok: mailResult.ok,
        });
      } catch (e) {
        log(`mail relay maintain fatal: ${/** @type {Error} */ (e).stack || e}`);
        exitCode = 1;
        recordStep(reportCtx, {
          id: "mail-relay",
          title: "Postfix satellite (mail relay)",
          ran: true,
          ok: false,
          notes: [String(/** @type {Error} */ (e).message || e)],
        });
      }
    } else {
      recordStep(reportCtx, {
        id: "mail-relay",
        title: "Postfix satellite (mail relay)",
        ran: false,
        skipReason: "--skip-mail-relay",
      });
    }

    if (!skipOemLicense) {
      try {
        const oemResult = await runProxmoxOemWindowsLicenseReport({
          packageRoot,
          log,
          warn,
          dryRun,
          env: deps.env,
          spawnSync: deps.spawnSync,
        });
        reportCtx.oemWindowsLicense = oemResult.hosts ?? [];
        if (!oemResult.ok) exitCode = 1;
        recordStep(reportCtx, {
          id: "oem-license",
          title: "OEM Windows license (SLIC/MSDM)",
          ran: true,
          ok: oemResult.ok,
        });
      } catch (e) {
        log(`OEM license report fatal: ${/** @type {Error} */ (e).stack || e}`);
        exitCode = 1;
        recordStep(reportCtx, {
          id: "oem-license",
          title: "OEM Windows license (SLIC/MSDM)",
          ran: true,
          ok: false,
          notes: [String(/** @type {Error} */ (e).message || e)],
        });
      }
    } else {
      recordStep(reportCtx, {
        id: "oem-license",
        title: "OEM Windows license (SLIC/MSDM)",
        ran: false,
        skipReason: "--skip-oem-license",
      });
    }

    if (!skipGuestAgent) {
      try {
        const gaResult = await runProxmoxQemuGuestAgentReport({
          packageRoot,
          log,
          warn,
          vault,
        });
        reportCtx.qemuGuestAgent = gaResult.data;
        if (!gaResult.ok) exitCode = 1;
        for (const w of gaResult.data?.warnings ?? []) {
          pushWarning(reportCtx, w);
        }
        recordStep(reportCtx, {
          id: "guest-agent",
          title: "QEMU guest agent",
          ran: true,
          ok: gaResult.ok,
        });
      } catch (e) {
        log(`QEMU guest agent report fatal: ${/** @type {Error} */ (e).stack || e}`);
        exitCode = 1;
        recordStep(reportCtx, {
          id: "guest-agent",
          title: "QEMU guest agent",
          ran: true,
          ok: false,
          notes: [String(/** @type {Error} */ (e).message || e)],
        });
      }
    } else {
      recordStep(reportCtx, {
        id: "guest-agent",
        title: "QEMU guest agent",
        ran: false,
        skipReason: "--skip-guest-agent",
      });
    }

    if (!skipHostFirewall) {
      try {
        const hfResult = await runProxmoxHostFirewallMaintain({
          packageRoot,
          log,
          warn,
          dryRun,
          env: deps.env,
          spawnSync: deps.spawnSync,
        });
        if (!hfResult.ok) exitCode = 1;
        recordStep(reportCtx, {
          id: "host-firewall",
          title: "Host firewall (SSH/8006)",
          ran: true,
          ok: hfResult.ok !== false,
          notes: hfResult.skipped ? [String(hfResult.reason ?? "skipped")] : undefined,
        });
      } catch (e) {
        log(`host firewall maintain fatal: ${/** @type {Error} */ (e).stack || e}`);
        exitCode = 1;
        recordStep(reportCtx, {
          id: "host-firewall",
          title: "Host firewall (SSH/8006)",
          ran: true,
          ok: false,
          notes: [String(/** @type {Error} */ (e).message || e)],
        });
      }
    } else {
      recordStep(reportCtx, {
        id: "host-firewall",
        title: "Host firewall (SSH/8006)",
        ran: false,
        skipReason: "--skip-host-firewall",
      });
    }

    if (!skipGuestFirewall) {
      try {
        const gfResult = await runProxmoxGuestFirewallMaintain({
          packageRoot,
          repoRoot: repoRoot(),
          log,
          warn,
          dryRun,
          env: deps.env,
          spawnSync: deps.spawnSync,
        });
        if (!gfResult.ok) exitCode = 1;
        recordStep(reportCtx, {
          id: "guest-firewall",
          title: "Guest firewall (managed vmids)",
          ran: true,
          ok: gfResult.ok !== false,
          notes: gfResult.skipped ? [String(gfResult.reason ?? "skipped")] : undefined,
        });
      } catch (e) {
        log(`guest firewall maintain fatal: ${/** @type {Error} */ (e).stack || e}`);
        exitCode = 1;
        recordStep(reportCtx, {
          id: "guest-firewall",
          title: "Guest firewall (managed vmids)",
          ran: true,
          ok: false,
          notes: [String(/** @type {Error} */ (e).message || e)],
        });
      }
    } else {
      recordStep(reportCtx, {
        id: "guest-firewall",
        title: "Guest firewall (managed vmids)",
        ran: false,
        skipReason: "--skip-guest-firewall",
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
          publicRoot: repoRoot(),
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
