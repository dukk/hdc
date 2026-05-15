/**
 * Debian/Proxmox-oriented Nagios deploy: central nagios4 + NRPE on primary cluster nodes.
 * Requires `ssh` and `scp` in PATH (e.g. Git for Windows). Paths assume Debian nagios4/nrpe packages.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findInventorySidecars } from "../../../tools/hdc/inventory.mjs";
import {
  asObject,
  buildNagiosBundle,
  hypervisorSshTargetsForLogicalCluster,
  readJson,
  renderNrpeCfg,
  resolveCentral,
} from "../lib/generate.mjs";
import { nagiosRepoRoot, PRIMARY_PROXMOX_CLUSTER_INVENTORY_ID, primaryClusterInventoryPath } from "../lib/repo.mjs";
import { scpToRemote, sshRemote } from "../lib/remote.mjs";

function loadSidecars(root) {
  /** @type {Record<string, unknown>[]} */
  const out = [];
  for (const p of findInventorySidecars(root)) {
    try {
      out.push(asObject(readJson(p)));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[hdc] Nagios deploy: skip ${p}: ${msg}`);
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
  const clusterPath = primaryClusterInventoryPath(root);
  let cluster;
  try {
    cluster = asObject(readJson(clusterPath));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    die(`[hdc] Nagios deploy: cannot read cluster inventory ${clusterPath}: ${msg}`);
  }
  let central;
  try {
    central = resolveCentral(cluster);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    die(`[hdc] Nagios deploy: ${msg}`);
  }
  const sidecars = loadSidecars(root);
  const hypervisors = hypervisorSshTargetsForLogicalCluster(sidecars, PRIMARY_PROXMOX_CLUSTER_INVENTORY_ID);
  if (hypervisors.length === 0) {
    die("[hdc] Nagios deploy: no hypervisor SSH targets for primary cluster members (proxmox_cluster role node).");
  }
  const bundle = buildNagiosBundle(sidecars, PRIMARY_PROXMOX_CLUSTER_INVENTORY_ID);
  const nrpeContent = renderNrpeCfg(central.nrpeAllowedHost);

  const tmp = mkdtempSync(join(tmpdir(), "hdc-nagios-"));
  const localNrpe = join(tmp, "nrpe.cfg");
  const localNagios = join(tmp, "hdc-generated.cfg");
  try {
    writeFileSync(localNrpe, nrpeContent, "utf8");
    writeFileSync(localNagios, bundle.nagiosCfg, "utf8");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    die(`[hdc] Nagios deploy: failed to write temp configs: ${msg}`);
  }

  const installNrpe =
    "export DEBIAN_FRONTEND=noninteractive; apt-get update -qq && apt-get install -y nagios-nrpe-server monitoring-plugins";
  for (const { user, host } of hypervisors) {
    console.error(`[hdc] Nagios deploy: NRPE packages on ${user}@${host}`);
    const r1 = sshRemote(user, host, installNrpe);
    if (r1.status !== 0) die(`[hdc] Nagios deploy: apt install failed on ${host} (exit ${r1.status})`);
    console.error(`[hdc] Nagios deploy: push nrpe.cfg to ${user}@${host}`);
    if (scpToRemote(user, host, localNrpe, "/etc/nagios/nrpe.cfg") !== 0) {
      die(`[hdc] Nagios deploy: scp nrpe.cfg failed for ${host}`);
    }
    const r2 = sshRemote(user, host, "systemctl enable nagios-nrpe-server 2>/dev/null; systemctl restart nagios-nrpe-server");
    if (r2.status !== 0) die(`[hdc] Nagios deploy: nrpe restart failed on ${host}`);
  }

  const installCentral =
    "export DEBIAN_FRONTEND=noninteractive; apt-get update -qq && apt-get install -y nagios4 nagios-nrpe-plugin monitoring-plugins";
  console.error(`[hdc] Nagios deploy: Nagios packages on ${central.sshUser}@${central.sshHost}`);
  const c1 = sshRemote(central.sshUser, central.sshHost, installCentral);
  if (c1.status !== 0) die(`[hdc] Nagios deploy: apt install failed on central ${central.sshHost}`);

  console.error(`[hdc] Nagios deploy: push hdc-generated.cfg to central`);
  if (scpToRemote(central.sshUser, central.sshHost, localNagios, "/etc/nagios4/conf.d/hdc-generated.cfg") !== 0) {
    die("[hdc] Nagios deploy: scp nagios objects failed on central host");
  }
  const validateReload =
    "/usr/sbin/nagios4 -v /etc/nagios4/nagios.cfg && systemctl reload nagios4";
  const c2 = sshRemote(central.sshUser, central.sshHost, validateReload);
  if (c2.status !== 0) die(`[hdc] Nagios deploy: nagios4 -v or reload failed on central (exit ${c2.status})`);

  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* ignore */
  }

  console.error(
    `[hdc] Nagios deploy: ok — ${bundle.stats.hostCount} hosts, ${bundle.stats.serviceCount} services, ${hypervisors.length} NRPE nodes.`,
  );
}

main();
