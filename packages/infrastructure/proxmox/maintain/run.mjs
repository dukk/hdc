#!/usr/bin/env node
/**
 * Proxmox maintain:
 * 1. Install local SSH public keys on each hypervisor (password from vault if needed).
 * 2. Ensure hdc API token role/ACL (VM.Audit, Datastore.Audit, …) via pveum over SSH.
 * 3. Verify provision templates (LXC ostemplate on each node; QEMU template_vmid in cluster).
 * 4. Ensure NAS storage connections (nas-1, nas-2 by default) on each cluster/standalone group.
 * 5. apt update/dist-upgrade on each hypervisor via SSH public-key auth; sequential reboot if required.
 * 6. Ensure local `hdc` user on bootstrap hosts (see `users bootstrap-hdc`).
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

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, "..");

/**
 * @param {string} line
 */
function log(line) {
  errout.write(`[proxmox] maintain: ${line}\n`);
}

/**
 * @param {string[]} argv
 */
function bootstrapArgv(argv) {
  return argv.filter((a) => a !== "--skip-bootstrap" && a !== "--skip-templates");
}

async function main() {
  const argv = process.argv.slice(2);
  const skipBootstrap = argv.includes("--skip-bootstrap");
  const skipTemplates = argv.includes("--skip-templates");
  const skipStorage = argv.includes("--skip-storage");
  const skipApiToken = argv.includes("--skip-api-token");
  const skipSshKeys = argv.includes("--skip-ssh-keys");
  const skipOsUpdates = argv.includes("--skip-os-updates");
  const dryRun = argv.includes("--dry-run");
  const noDownload = argv.includes("--no-download");
  const noBuildQemu = argv.includes("--no-build-qemu");
  const noPrune = argv.includes("--no-prune");

  errout.write("[proxmox] maintain: starting (stderr log).\n");

  let exitCode = 0;
  const deps = createNodeCliDeps();
  const vault = createVaultAccess(vaultDepsFromCli(deps));

  const needsVault = !skipTemplates || !skipStorage || !skipSshKeys || !skipApiToken;
  if (needsVault) {
    try {
      await vault.unlock({});
    } catch (e) {
      if (e instanceof CliExit) {
        process.exit(e.code);
      }
      throw e;
    }
  }

  if (!skipSshKeys) {
    try {
      const sshResult = await runProxmoxSshKeysMaintain({
        packageRoot,
        log,
        warn: (line) => errout.write(`[proxmox] maintain: WARN ${line}\n`),
        vault,
        dryRun,
        env: deps.env,
        spawnSync: deps.spawnSync,
        readLineQuestion: deps.readLineQuestion,
      });
      if (!sshResult.ok) exitCode = 1;
    } catch (e) {
      if (e instanceof CliExit) {
        exitCode = exitCode || e.code;
      } else {
        log(`SSH keys maintain fatal: ${/** @type {Error} */ (e).stack || e}`);
        exitCode = 1;
      }
    }
  }

  if (!skipApiToken) {
    try {
      const tokenResult = await runProxmoxApiTokenMaintain({
        packageRoot,
        log,
        warn: (line) => errout.write(`[proxmox] maintain: WARN ${line}\n`),
        vault,
        env: deps.env,
        spawnSync: deps.spawnSync,
        dryRun,
      });
      if (!tokenResult.ok) exitCode = 1;
    } catch (e) {
      if (e instanceof CliExit) {
        exitCode = exitCode || e.code;
      } else {
        log(`API token maintain fatal: ${/** @type {Error} */ (e).stack || e}`);
        exitCode = 1;
      }
    }
  }

  if (!skipTemplates) {
    try {
      const result = await runProxmoxMaintainTemplates({
        packageRoot,
        log,
        warn: (line) => errout.write(`[proxmox] maintain: WARN ${line}\n`),
        vault,
        downloadMissing: !noDownload,
        buildQemuTemplate: !noBuildQemu,
        pruneUnsupported: !noPrune,
        dryRun,
      });
      if (!result.ok) exitCode = 1;
    } catch (e) {
      if (e instanceof CliExit) {
        exitCode = exitCode || e.code;
      } else {
        log(`template check fatal: ${/** @type {Error} */ (e).stack || e}`);
        exitCode = 1;
      }
    }
  }

  if (!skipStorage) {
    try {
      const storageResult = await runProxmoxStorageMaintain({
        packageRoot,
        log,
        warn: (line) => errout.write(`[proxmox] maintain: WARN ${line}\n`),
        vault,
        dryRun,
      });
      if (!storageResult.ok) exitCode = 1;
    } catch (e) {
      if (e instanceof CliExit) {
        exitCode = exitCode || e.code;
      } else {
        log(`storage maintain fatal: ${/** @type {Error} */ (e).stack || e}`);
        exitCode = 1;
      }
    }
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
        warn: (line) => errout.write(`[proxmox] maintain: WARN ${line}\n`),
        dryRun,
        env: deps.env,
        spawnSync: deps.spawnSync,
        rebootWaitMs,
      });
      if (!osResult.ok) exitCode = 1;
    } catch (e) {
      log(`host OS maintain fatal: ${/** @type {Error} */ (e).stack || e}`);
      exitCode = 1;
    }
  }

  if (!skipBootstrap) {
    const bootstrapHosts = bootstrapHostDocsFromInfrastructureConfigs(deps.repoRoot(), deps);
    if (!bootstrapHosts.length) {
      log("skip bootstrap-hdc (bootstrap_hosts is empty).");
    } else {
      try {
        await runUsersBootstrapHdc(bootstrapArgv(argv), deps, { vault });
      } catch (e) {
        if (e instanceof CliExit) {
          exitCode = exitCode || e.code;
        } else {
          console.error(e);
          exitCode = 1;
        }
      }
    }
  }

  if (exitCode === 0) log("finished OK.");
  else log("finished with errors.");
  process.exit(exitCode);
}

main();
