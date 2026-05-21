/**
 * Debian/Proxmox-oriented Nagios deploy: central nagios4 + NRPE on primary cluster nodes.
 * Requires `ssh` and `scp` in PATH (e.g. Git for Windows). Paths assume Debian nagios4/nrpe packages.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  nagiosRepoRoot,
  centralClusterDocument,
  nagiosMonitoredSystems,
  nagiosNrpeNodeIds,
  primaryProxmoxClusterId,
  NAGIOS_CENTRAL_SYSTEM_ID,
} from "../lib/repo.mjs";
import {
  asObject,
  buildNagiosBundle,
  hypervisorSshTargetsForLogicalCluster,
  renderNrpeCfg,
  resolveCentral,
} from "../lib/generate.mjs";
import { scpToRemote, sshRemote } from "../lib/remote.mjs";

function die(msg, code = 1) {
  console.error(msg);
  process.exit(code);
}

function main() {
  const root = nagiosRepoRoot();
  let cluster;
  try {
    cluster = asObject(centralClusterDocument(root));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    die(`[hdc] Nagios deploy: ${msg}`);
  }
  let central;
  try {
    central = resolveCentral(cluster);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    die(`[hdc] Nagios deploy: ${msg}`);
  }
  const sidecars = nagiosMonitoredSystems(root);
  const clusterId = primaryProxmoxClusterId(root);
  const hypervisors = hypervisorSshTargetsForLogicalCluster(sidecars, clusterId);
  if (hypervisors.length === 0) {
    die("[hdc] Nagios deploy: no hypervisor SSH targets for primary cluster members (proxmox_cluster role node).");
  }
  const bundle = buildNagiosBundle(sidecars, clusterId);
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
    `[hdc] Nagios deploy: ok — ${bundle.stats.hostCount} hosts, ${bundle.stats.serviceCount} services, ${hypervisors.length} NRPE nodes (cluster ${nagiosNrpeNodeIds(root).join(", ")}, central ${NAGIOS_CENTRAL_SYSTEM_ID}).`,
  );
}

main();
