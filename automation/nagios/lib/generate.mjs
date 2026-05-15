import { readFileSync } from "node:fs";
import { PRIMARY_PROXMOX_CLUSTER_INVENTORY_ID } from "./repo.mjs";
import { httpCheckArgs, parseSshUri } from "./parse.mjs";

const PLUGIN = "/usr/lib/nagios/plugins";

/**
 * @param {string} sidecarId
 * @param {string} nodeName
 */
export function nagiosHostName(sidecarId, nodeName) {
  const raw = `${sidecarId}_${nodeName}`.replace(/[^a-zA-Z0-9_-]/g, "_");
  return raw.slice(0, 200) || "host";
}

/**
 * @param {unknown} data
 * @returns {Record<string, unknown>}
 */
export function asObject(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  return /** @type {Record<string, unknown>} */ (data);
}

/**
 * @param {string} path
 */
export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * @param {Record<string, unknown>} cluster
 * @returns {{ address: string, sshHost: string, sshUser: string, nrpeAllowedHost: string }}
 */
export function resolveCentral(cluster) {
  const nagios = asObject(cluster.nagios);
  const central = asObject(nagios.central);
  const address = typeof central.address === "string" ? central.address.trim() : "";
  if (!address) {
    throw new Error(
      "inventory/manual/systems/pve-a.inventory.json: set nagios.central.address to your Nagios host IP (NRPE allowed_hosts + check target).",
    );
  }
  const sshUri = typeof central.ssh === "string" ? central.ssh.trim() : "";
  const parsed = parseSshUri(sshUri);
  const nagAuth = asObject(nagios.auth);
  const clusterAuth = asObject(cluster.auth);
  const nagEnv = typeof nagAuth.ssh_user_env === "string" ? nagAuth.ssh_user_env.trim() : "";
  const clusterEnv = typeof clusterAuth.ssh_user_env === "string" ? clusterAuth.ssh_user_env.trim() : "";
  const sshHost = parsed?.host?.trim() || address;
  let sshUser = parsed?.user?.trim() || "";
  if (!sshUser) {
    if (nagEnv) {
      const v = process.env[nagEnv];
      if (typeof v === "string" && v.trim()) sshUser = v.trim();
    }
    if (!sshUser && clusterEnv) {
      const v = process.env[clusterEnv];
      if (typeof v === "string" && v.trim()) sshUser = v.trim();
    }
  }
  if (!sshUser) {
    throw new Error(
      "Central Nagios SSH user: set user in nagios.central.ssh (e.g. ssh://root@10.0.0.x) and/or set HDC_NAGIOS_SSH_USER / HDC_PROXMOX_SSH_USER per inventory env refs.",
    );
  }
  return { address, sshHost, sshUser, nrpeAllowedHost: address };
}

/**
 * @param {string} allowedHost
 */
export function renderNrpeCfg(allowedHost) {
  return `# Managed by HDC Nagios deploy — do not edit manually on node
pid_file=/var/run/nagios/nrpe.pid
server_port=5666
nrpe_user=nagios
nrpe_group=nagios
dont_blame_nrpe=0
debug=0
server_address=0.0.0.0
allowed_hosts=127.0.0.1,${allowedHost}
command_timeout=60
connection_timeout=300

command[check_load]=${PLUGIN}/check_load -r -w .15,.10,.05 -c .30,.25,.20
command[check_disk_root]=${PLUGIN}/check_disk -w 20% -c 10% -p /
command[check_pvedaemon]=${PLUGIN}/check_procs -c 1:40 -C pvedaemon
command[check_pvecluster]=${PLUGIN}/check_procs -c 1: -C pve-cluster
`;
}

/**
 * @typedef {{ nagiosHostName: string, address: string, alias: string, nrpe: boolean, httpArgs: string | null }} MonHost
 */

/**
 * @param {Record<string, unknown>} sidecar
 * @param {string} primaryClusterId
 * @returns {MonHost[]}
 */
export function hostsFromSidecar(sidecar, primaryClusterId) {
  const id = typeof sidecar.id === "string" ? sidecar.id : "unknown";
  const access = asObject(sidecar.access);
  const nodes = access.nodes;
  if (!Array.isArray(nodes)) return [];
  const pc = asObject(sidecar.proxmox_cluster);
  const clusterId = typeof pc.id === "string" ? pc.id.trim() : "";
  const clusterRole = typeof pc.role === "string" ? pc.role.trim() : "";
  const nrpeForPrimary =
    id === primaryClusterId ||
    (clusterId === primaryClusterId && clusterRole === "node");
  /** @type {MonHost[]} */
  const out = [];
  for (const n of nodes) {
    const o = asObject(n);
    const ip = typeof o.ip === "string" ? o.ip.trim() : "";
    if (!ip) continue;
    const nodeName = typeof o.name === "string" && o.name.trim() ? o.name.trim() : "node";
    const web = typeof o.web_ui === "string" ? o.web_ui : "";
    const http = httpCheckArgs(web, ip);
    out.push({
      nagiosHostName: nagiosHostName(id, nodeName),
      address: ip,
      alias: `${nodeName} (${id})`,
      nrpe: nrpeForPrimary,
      httpArgs: http ? http.args : null,
    });
  }
  return out;
}

/**
 * @param {Record<string, unknown>[]} sidecars
 * @param {string} primaryClusterId
 * @returns {{ hosts: MonHost[], nagiosCfg: string, stats: { hostCount: number, serviceCount: number } }}
 */
export function buildNagiosBundle(sidecars, primaryClusterId) {
  /** @type {MonHost[]} */
  const hosts = [];
  for (const s of sidecars) {
    hosts.push(...hostsFromSidecar(s, primaryClusterId));
  }
  const lines = [];
  lines.push("###############################################################################");
  lines.push("# HDC Nagios — generated — do not edit on server");
  lines.push("###############################################################################");
  lines.push("");
  let serviceCount = 0;
  for (const h of hosts) {
    lines.push("define host {");
    lines.push(`  host_name ${h.nagiosHostName}`);
    lines.push(`  alias ${escapeNagiosString(h.alias)}`);
    lines.push(`  address ${h.address}`);
    lines.push("  use generic-host");
    lines.push("}");
    lines.push("");
    lines.push("define service {");
    lines.push(`  host_name ${h.nagiosHostName}`);
    lines.push("  service_description PING");
    lines.push("  check_command check_ping!100.0,20%!500.0,60%");
    lines.push("  use generic-service");
    lines.push("}");
    lines.push("");
    serviceCount++;
    if (h.httpArgs) {
      lines.push("define service {");
      lines.push(`  host_name ${h.nagiosHostName}`);
      lines.push("  service_description HTTP_UI");
      lines.push(`  check_command check_http!${h.httpArgs}`);
      lines.push("  use generic-service");
      lines.push("}");
      lines.push("");
      serviceCount++;
    }
    if (h.nrpe) {
      const nrpeServices = [
        ["NRPE_Load", "check_load"],
        ["NRPE_Disk_Root", "check_disk_root"],
        ["NRPE_pvedaemon", "check_pvedaemon"],
        ["NRPE_pve-cluster", "check_pvecluster"],
      ];
      for (const [desc, cmd] of nrpeServices) {
        lines.push("define service {");
        lines.push(`  host_name ${h.nagiosHostName}`);
        lines.push(`  service_description ${desc}`);
        lines.push(`  check_command check_nrpe!${cmd}`);
        lines.push("  use generic-service");
        lines.push("}");
        lines.push("");
        serviceCount++;
      }
    }
  }
  return {
    hosts,
    nagiosCfg: lines.join("\n"),
    stats: { hostCount: hosts.length, serviceCount },
  };
}

/** @param {string} s */
function escapeNagiosString(s) {
  return s.replace(/[\r\n]/g, " ").replace(/#/g, "");
}

/**
 * @param {Record<string, unknown>} cluster
 * @returns {{ user: string, host: string }[]}
 */
export function hypervisorSshTargets(cluster) {
  const clusterAuth = asObject(cluster.auth);
  const envName = typeof clusterAuth.ssh_user_env === "string" ? clusterAuth.ssh_user_env.trim() : "";
  const defaultUser = envName ? String(process.env[envName] ?? "").trim() : "";
  const access = asObject(cluster.access);
  const nodes = access.nodes;
  if (!Array.isArray(nodes)) return [];
  /** @type {{ user: string, host: string }[]} */
  const out = [];
  for (const n of nodes) {
    const o = asObject(n);
    const ip = typeof o.ip === "string" ? o.ip.trim() : "";
    const ssh = typeof o.ssh === "string" ? o.ssh.trim() : "";
    const p = parseSshUri(ssh);
    const host = (p?.host && p.host.trim()) || ip;
    if (!host) continue;
    const user = (p?.user && p.user.trim()) || defaultUser;
    if (!user) {
      throw new Error(
        "Each cluster node needs an SSH user in access.nodes[].ssh (e.g. ssh://root@10.0.0.11) or set auth.ssh_user_env in .env.",
      );
    }
    out.push({ user, host });
  }
  return out;
}

/**
 * SSH targets for every inventory system that is a `role: node` member of a logical Proxmox cluster.
 * @param {Record<string, unknown>[]} sidecars
 * @param {string} [logicalClusterId]
 */
export function hypervisorSshTargetsForLogicalCluster(sidecars, logicalClusterId = PRIMARY_PROXMOX_CLUSTER_INVENTORY_ID) {
  const want = logicalClusterId.trim();
  /** @type {{ user: string, host: string }[]} */
  const out = [];
  const seen = new Set();
  for (const s of sidecars) {
    const pc = asObject(s.proxmox_cluster);
    const cid = typeof pc.id === "string" ? pc.id.trim() : "";
    const role = typeof pc.role === "string" ? pc.role.trim() : "";
    if (cid !== want || role !== "node") continue;
    for (const t of hypervisorSshTargets(s)) {
      const key = `${t.user}@${t.host}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(t);
      }
    }
  }
  return out;
}
