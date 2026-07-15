#!/usr/bin/env node
/**
 * Pull guest-authoritative operations/ content from hdc-agents /opt/hdc-private
 * into the local hdc-private repo.
 *
 * Usage:
 *   node tools/scripts/pull-hdc-private-from-agents.mjs
 *   node tools/scripts/pull-hdc-private-from-agents.mjs --dry-run
 *   node tools/scripts/pull-hdc-private-from-agents.mjs --host 10.0.0.117
 *   node tools/scripts/pull-hdc-private-from-agents.mjs --instance a
 *   node tools/scripts/pull-hdc-private-from-agents.mjs --system-id hdc-agents-a
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { repoRoot } from "../../apps/hdc-cli/paths.mjs";
import { hdcPrivateRoot, resolveRepoFile } from "../../apps/hdc-cli/lib/private-repo.mjs";
import { loadClumpConfigFromClumpRoot } from "../../clumps/lib/clump-run-config.mjs";
import { resolveHdcAgentsDeployments } from "../../clumps/services/hdc-agents/lib/deployments.mjs";
import {
  readCtPrimaryIp,
  resolvePveSshForHost,
} from "../../clumps/services/hdc-agents/lib/hdc-agents-install.mjs";

const GUEST_PRIVATE_ROOT = "/opt/hdc-private";
const SSH_USER = "hdc";
const SSH_OPTS = ["-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new"];

/** @type {{ remote: string; local: string; kind: "dir" | "file" }[]} */
const PULL_PATHS = [
  { remote: "operations/tasks", local: "operations/tasks", kind: "dir" },
  { remote: "operations/task-report.md", local: "operations/task-report.md", kind: "file" },
  {
    remote: "operations/.dispatcher-state.json",
    local: "operations/.dispatcher-state.json",
    kind: "file",
  },
  { remote: "operations/proposals", local: "operations/proposals", kind: "dir" },
  { remote: "operations/reports", local: "operations/reports", kind: "dir" },
];

const HELP = `pull-hdc-private-from-agents — guest-authoritative operations/ pull

Usage:
  node tools/scripts/pull-hdc-private-from-agents.mjs [options]

Options:
  --dry-run           Show planned transfers without writing local files
  --host <ip>         Guest IP (skip auto-resolve)
  --system-id <id>    Target system (default: hdc-agents-a)
  --instance <letter> Deployment instance letter (e.g. a)
  --help              Show this help

Pulls from ${GUEST_PRIVATE_ROOT}/ on hdc-agents into local hdc-private (HDC_PRIVATE_ROOT or ../hdc-private).
Does not use --delete; missing remote paths are skipped with a warning.
`;

/**
 * @param {typeof spawnSync} [spawnFn]
 */
function hasRsyncOnPath(spawnFn = spawnSync) {
  const checker = process.platform === "win32" ? "where" : "which";
  const r = spawnFn(checker, ["rsync"], { encoding: "utf8", shell: true });
  return r.status === 0;
}

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  /** @type {Record<string, string | boolean>} */
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      flags.help = true;
      continue;
    }
    if (a === "--dry-run") {
      flags["dry-run"] = true;
      continue;
    }
    if (a === "--host" && argv[i + 1]) {
      flags.host = argv[++i];
      continue;
    }
    if (a === "--system-id" && argv[i + 1]) {
      flags["system-id"] = argv[++i];
      continue;
    }
    if (a === "--instance" && argv[i + 1]) {
      flags.instance = argv[++i];
      continue;
    }
    throw new Error(`unknown argument: ${a}`);
  }
  return flags;
}

/**
 * @param {string} host
 * @param {string} remoteRel
 * @param {typeof spawnSync} spawnFn
 */
function remotePathExists(host, remoteRel, spawnFn) {
  const remote = `${GUEST_PRIVATE_ROOT}/${remoteRel}`.replace(/\\/g, "/");
  const r = spawnFn(
    "ssh",
    [...SSH_OPTS, `${SSH_USER}@${host}`, `test -e ${JSON.stringify(remote)}`],
    { encoding: "utf8", shell: false },
  );
  return r.status === 0;
}

/**
 * @param {object} opts
 * @param {string} opts.host
 * @param {string} opts.remoteRel
 * @param {string} opts.localPath
 * @param {boolean} opts.dryRun
 * @param {"dir" | "file"} opts.kind
 * @param {typeof spawnSync} opts.spawnFn
 */
function pullWithRsync(opts) {
  const remoteBase = `${GUEST_PRIVATE_ROOT}/${opts.remoteRel}`.replace(/\\/g, "/");
  const remoteSrc =
    opts.kind === "dir"
      ? remoteBase.endsWith("/")
        ? remoteBase
        : `${remoteBase}/`
      : remoteBase;
  const localDest =
    opts.kind === "dir"
      ? opts.localPath.endsWith("/")
        ? opts.localPath
        : `${opts.localPath}/`
      : opts.localPath;

  /** @type {string[]} */
  const args = ["-avz", "-e", `ssh ${SSH_OPTS.join(" ")}`];
  if (opts.dryRun) args.push("-n");
  args.push(`${SSH_USER}@${opts.host}:${remoteSrc}`, localDest);

  const r = opts.spawnFn("rsync", args, { encoding: "utf8", shell: false });
  return {
    ok: r.status === 0,
    message: `${r.stderr}${r.stdout}`.trim() || (r.status === 0 ? "rsync ok" : `exit ${r.status}`),
  };
}

/**
 * @param {object} opts
 * @param {string} opts.host
 * @param {string} opts.remoteRel
 * @param {string} opts.localRoot
 * @param {boolean} opts.dryRun
 * @param {typeof spawnSync} opts.spawnFn
 */
function pullWithTar(opts) {
  if (opts.dryRun) {
    return { ok: true, message: "tar dry-run ok" };
  }

  const remoteTarPath = opts.remoteRel.replace(/\\/g, "/");
  const remoteCmd = `tar -cf - -C ${JSON.stringify(GUEST_PRIVATE_ROOT)} ${JSON.stringify(remoteTarPath)}`;

  const ssh = opts.spawnFn("ssh", [...SSH_OPTS, `${SSH_USER}@${opts.host}`, remoteCmd], {
    encoding: "buffer",
    maxBuffer: 1024 * 1024 * 256,
    shell: false,
  });
  if (ssh.status !== 0) {
    const detail = Buffer.isBuffer(ssh.stderr) ? ssh.stderr.toString("utf8") : String(ssh.stderr ?? "");
    return { ok: false, message: detail.trim() || `ssh tar pack failed exit ${ssh.status}` };
  }

  mkdirSync(opts.localRoot, { recursive: true });
  const untar = opts.spawnFn("tar", ["-xf", "-", "-C", opts.localRoot], {
    input: ssh.stdout,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 64,
    shell: false,
  });
  const ok = untar.status === 0;
  return {
    ok,
    message: ok
      ? "tar+ssh ok"
      : `${untar.stderr}${untar.stdout}`.trim() || `local tar extract failed exit ${untar.status}`,
  };
}

/**
 * @param {string} publicRoot
 * @param {Record<string, string | boolean>} flags
 */
function resolveGuestHost(publicRoot, flags) {
  if (typeof flags.host === "string" && flags.host.trim()) {
    return { host: flags.host.trim(), source: "flag --host" };
  }

  const clumpRoot = join(publicRoot, "clumps", "services", "hdc-agents");
  const cfg = loadClumpConfigFromClumpRoot(clumpRoot, {
    exampleRel: "clumps/services/hdc-agents/config.example.json",
  }).data;

  /** @type {Record<string, string>} */
  const deployFlags = {};
  if (typeof flags["system-id"] === "string") deployFlags["system-id"] = flags["system-id"];
  if (typeof flags.instance === "string") deployFlags.instance = flags.instance;

  const [deployment] = resolveHdcAgentsDeployments(cfg, deployFlags);
  const systemId = deployment.systemId;
  const px = deployment.proxmox;
  const hostId = typeof px.host_id === "string" ? px.host_id.trim() : "";
  const lxc = px.lxc && typeof px.lxc === "object" ? px.lxc : {};
  const vmid = typeof lxc.vmid === "number" ? lxc.vmid : Number(lxc.vmid);

  if (hostId && Number.isFinite(vmid) && vmid > 0) {
    const proxmoxRoot = join(publicRoot, "clumps", "infrastructure", "proxmox");
    const pveSsh = resolvePveSshForHost(proxmoxRoot, hostId);
    const ip = readCtPrimaryIp(pveSsh.user, pveSsh.host, vmid);
    if (ip) {
      return { host: ip, source: `pct ${vmid} on ${hostId}`, systemId };
    }
  }

  const inv = resolveRepoFile(publicRoot, `inventory/manual/systems/${systemId}.json`);
  if (inv.found) {
    const doc = JSON.parse(readFileSync(inv.path, "utf8"));
    const nodes = doc?.access?.nodes;
    if (Array.isArray(nodes) && nodes.length > 0) {
      const ip = typeof nodes[0]?.ip === "string" ? nodes[0].ip.trim() : "";
      if (ip) {
        return { host: ip, source: `inventory ${systemId}`, systemId };
      }
    }
  }

  throw new Error(
    `could not resolve guest IP for ${systemId} (use --host or ensure pct/inventory access)`,
  );
}

function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help) {
    console.log(HELP.trim());
    process.exit(0);
  }

  const publicRoot = repoRoot();
  const localPrivate = hdcPrivateRoot(publicRoot, process.env);
  if (!localPrivate) {
    console.error("hdc-private not found (set HDC_PRIVATE_ROOT or clone ../hdc-private)");
    process.exit(1);
  }

  const dryRun = flags["dry-run"] === true;
  let guest;
  try {
    guest = resolveGuestHost(publicRoot, flags);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const transport = hasRsyncOnPath() ? "rsync" : "tar+ssh";
  console.log(`Local hdc-private: ${localPrivate}`);
  console.log(`Guest: ${SSH_USER}@${guest.host} (${guest.source})`);
  console.log(`Transport: ${transport}${dryRun ? " (dry-run)" : ""}`);

  let pulled = 0;
  let skipped = 0;
  let failed = 0;

  for (const entry of PULL_PATHS) {
    const localPath = join(localPrivate, entry.local);
    const remoteFull = `${GUEST_PRIVATE_ROOT}/${entry.remote}`;

    if (!remotePathExists(guest.host, entry.remote, spawnSync)) {
      console.warn(`skip (missing on guest): ${remoteFull}`);
      skipped++;
      continue;
    }

    if (entry.kind === "dir") {
      mkdirSync(localPath, { recursive: true });
    } else {
      mkdirSync(dirname(localPath), { recursive: true });
    }

    console.log(`pull ${entry.remote} → ${entry.local}`);
    const result =
      transport === "rsync"
        ? pullWithRsync({
            host: guest.host,
            remoteRel: entry.remote,
            localPath,
            dryRun,
            kind: entry.kind,
            spawnFn: spawnSync,
          })
        : pullWithTar({
            host: guest.host,
            remoteRel: entry.remote,
            localRoot: localPrivate,
            dryRun,
            spawnFn: spawnSync,
          });

    if (result.ok) {
      pulled++;
      if (result.message && result.message !== "rsync ok" && result.message !== "tar+ssh ok") {
        console.log(result.message);
      }
    } else {
      failed++;
      console.error(`failed ${entry.remote}: ${result.message}`);
    }
  }

  console.log(`Done: ${pulled} pulled, ${skipped} skipped, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
