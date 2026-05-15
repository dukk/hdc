/**
 * Validate central Nagios config and optionally apply safe package upgrades on the central host.
 * Use `--apply-upgrades` to run `apt-get install --only-upgrade` for Nagios-related packages.
 */
import { findInventorySidecars } from "../../../tools/hdc/inventory.mjs";
import {
  asObject,
  buildNagiosBundle,
  readJson,
  resolveCentral,
} from "../lib/generate.mjs";
import { nagiosRepoRoot, PRIMARY_PROXMOX_CLUSTER_INVENTORY_ID, primaryClusterInventoryPath } from "../lib/repo.mjs";
import { sshRemote } from "../lib/remote.mjs";

const applyUpgrades = process.argv.includes("--apply-upgrades");

/** @param {string} root */
function loadSidecars(root) {
  /** @type {Record<string, unknown>[]} */
  const out = [];
  for (const p of findInventorySidecars(root)) {
    try {
      out.push(asObject(readJson(p)));
    } catch {
      /* skip */
    }
  }
  return out;
}

function die(msg, code = 1) {
  console.error(msg);
  process.exit(code);
}

function main() {
  const root = nagiosRepoRoot();
  const cluster = asObject(readJson(primaryClusterInventoryPath(root)));
  let central;
  try {
    central = resolveCentral(cluster);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    die(`[hdc] Nagios maintain: ${msg}`);
  }
  const sidecars = loadSidecars(root);
  buildNagiosBundle(sidecars, PRIMARY_PROXMOX_CLUSTER_INVENTORY_ID);

  if (applyUpgrades) {
    const up =
      "export DEBIAN_FRONTEND=noninteractive; apt-get update -qq && apt-get install -y --only-upgrade nagios4 nagios-nrpe-plugin monitoring-plugins";
    console.error(`[hdc] Nagios maintain: --apply-upgrades on ${central.sshUser}@${central.sshHost}`);
    const u = sshRemote(central.sshUser, central.sshHost, up);
    if (u.status !== 0) die(`[hdc] Nagios maintain: upgrades failed (exit ${u.status})`);
  }

  const v = sshRemote(central.sshUser, central.sshHost, "/usr/sbin/nagios4 -v /etc/nagios4/nagios.cfg");
  if (v.status !== 0) die(`[hdc] Nagios maintain: nagios4 -v failed (exit ${v.status})`);

  const reload = sshRemote(central.sshUser, central.sshHost, "systemctl reload nagios4");
  if (reload.status !== 0) die(`[hdc] Nagios maintain: reload failed (exit ${reload.status})`);

  console.error("[hdc] Nagios maintain: ok");
}

main();
