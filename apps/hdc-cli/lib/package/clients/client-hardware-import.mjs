/**
 * SSH Linux hardware collect → operations/inventory/systems/{physical|virtual}/<id>.json hardware[].
 * Used by `hdc run client raspberrypi|ubuntu query -- --import-hardware --yes`.
 */
import { spawnSync } from "node:child_process";
import { stderr as errout } from "node:process";

import { repoRoot } from "../../../paths.mjs";
import { discoverLocalSshMaterial, sshSpawn } from "../../ssh-host-access.mjs";
import { upsertPhysicalSystemHardware } from "../hardware-inventory.mjs";
import {
  hardwareCommand,
  parseHardwareOutput,
} from "hdc/clump/services/meshcentral/lib/meshcentral-ops.mjs";
import {
  hostsForPlatform,
  loadClientConfigFromPackageRoot,
  primaryNodeFromHost,
} from "./client-config.mjs";
import { isHostOnline } from "./client-reachability.mjs";

/** @param {unknown} v */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
/**
 * @param {object} opts
 * @param {string} opts.platform ubuntu | raspberrypi
 * @param {string} opts.clumpRoot
 * @param {Record<string, string | boolean>} opts.flags
 * @param {(line: string) => void} [opts.log]
 * @returns {Promise<{ ok: boolean; imported: Record<string, unknown>[]; message?: string }>}
 */
export async function importLinuxClientHardware(opts) {
  const log = opts.log ?? ((line) => errout.write(`[hdc] ${opts.platform} query: ${line}\n`));
  const yes = opts.flags.yes !== undefined;
  if (!yes) {
    return { ok: false, imported: [], message: "query --import-hardware requires --yes" };
  }

  const publicRoot = repoRoot();
  const cfg = loadClientConfigFromPackageRoot(opts.clumpRoot);
  const hostIdFilter =
    typeof opts.flags["host-id"] === "string" ? opts.flags["host-id"] : undefined;
  const hosts = hostsForPlatform(cfg, opts.platform, hostIdFilter);
  if (!hosts.length) {
    return {
      ok: false,
      imported: [],
      message: hostIdFilter
        ? `no enabled hosts for --host-id ${hostIdFilter}`
        : `no enabled hosts for platform ${opts.platform}`,
    };
  }

  const { identities } = discoverLocalSshMaterial();
  const cmd = hardwareCommand("linux");
  /** @type {Record<string, unknown>[]} */
  const imported = [];
  let ok = true;

  for (const host of hosts) {
    const id = String(host.id ?? "");
    const node = primaryNodeFromHost(host, process.env);
    /** @type {Record<string, unknown>} */
    const row = { id, ok: false };
    if (!node?.ip) {
      row.message = "missing access.nodes[].ip";
      imported.push(row);
      ok = false;
      continue;
    }
    row.ip = node.ip;
    if (!node.sshUser) {
      row.message = "SSH user not configured (HDC_CLIENT_SSH_USER)";
      imported.push(row);
      ok = false;
      continue;
    }
    const online = await isHostOnline(node.ip, 22);
    if (!online) {
      row.message = "host offline (SSH port closed)";
      imported.push(row);
      ok = false;
      continue;
    }

    log(`collecting hardware for ${id} via SSH …`);
    const target = { user: node.sshUser, host: node.ip };
    const r = sshSpawn(target, ["bash", "-lc", cmd], {
      spawnSync,
      env: process.env,
      mode: "pubkey",
      identities,
      timeoutMs: 120_000,
    });
    const output = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    if (r.status !== 0) {
      row.message = `ssh hardware collect failed (exit ${r.status})`;
      row.output_preview = output.slice(0, 400);
      imported.push(row);
      ok = false;
      continue;
    }
    const parsed = parseHardwareOutput(output);
    if (!parsed.ok) {
      row.message = parsed.message;
      row.output_preview = output.slice(0, 400);
      imported.push(row);
      ok = false;
      continue;
    }

    const written = upsertPhysicalSystemHardware({
      publicRoot,
      systemId: id,
      hardware: parsed.hardware,
      source: "client-ssh",
      accessNode: {
        ip: node.ip,
        ...(parsed.mac ? { mac: parsed.mac } : {}),
        ssh: `ssh://${node.sshUser}@${node.ip}`,
      },
      tags: ["client", opts.platform === "raspberrypi" ? "raspberrypi" : "ubuntu"],
      automationTargets: ["client"],
      extraFields: {
        auth: isObject(host.auth) ? host.auth : { ssh_user_env: "HDC_CLIENT_SSH_USER" },
        query_last: {
          source: "client-ssh",
          collected_at: new Date().toISOString(),
          name: id,
          platform: opts.platform,
          online: true,
          hardware_collected_at: new Date().toISOString(),
        },
      },
      log: (line) => log(line),
    });

    row.ok = true;
    row.rel = written.rel;
    row.hardware_count = parsed.hardware.length;
    row.mac = parsed.mac;
    imported.push(row);
  }

  return { ok, imported };
}
