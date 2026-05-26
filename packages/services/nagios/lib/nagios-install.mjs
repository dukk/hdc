import { stderr as errout } from "node:process";

import { pctExec } from "../../../lib/pve-pct-remote.mjs";
import { resolvePveSshForHost, waitForCt } from "../../pi-hole/lib/pi-hole-install.mjs";

export { resolvePveSshForHost, waitForCt };

export const NAGIOS_GENERATED_CFG = "/etc/nagios4/conf.d/hdc-generated.cfg";

/**
 * @param {{ upgrade?: boolean }} [opts]
 */
export function buildNagiosInstallScript(opts = {}) {
  const upgrade = opts.upgrade === true;
  const lines = [
    "set -euo pipefail",
    "export DEBIAN_FRONTEND=noninteractive",
    "apt-get update -qq",
    "apt-get install -y -qq nagios4 monitoring-plugins",
  ];
  if (upgrade) {
    lines.push("systemctl stop nagios4 2>/dev/null || true");
  }
  lines.push(
    "mkdir -p /etc/nagios4/conf.d",
    "systemctl enable nagios4",
    "systemctl restart nagios4",
    "sleep 2",
    "systemctl is-active --quiet nagios4",
    "test -x /usr/sbin/nagios4",
  );
  return lines.join("\n");
}

/**
 * @param {string} user
 * @param {string} pveHost
 * @param {number} vmid
 * @param {{ upgrade?: boolean }} [opts]
 */
export async function installNagiosInCt(user, pveHost, vmid, opts = {}) {
  const label = opts.upgrade ? "upgrade" : "install";
  errout.write(`[hdc] nagios ${label}: packages in CT ${vmid} …\n`);

  const ready = await waitForCt(user, pveHost, vmid, 2000, `nagios ${label}`);
  if (!ready) {
    return { ok: false, method: label, message: `CT ${vmid} not reachable via pct exec` };
  }

  const inner = buildNagiosInstallScript(opts);
  const r = pctExec(user, pveHost, vmid, inner);
  if (r.status !== 0) {
    return {
      ok: false,
      method: label,
      message: `nagios ${label} failed (exit ${r.status})`,
      stderr: r.stderr?.slice(0, 500),
    };
  }
  errout.write(`[hdc] nagios ${label}: completed on CT ${vmid}.\n`);
  return { ok: true, method: label, message: "installed" };
}

/**
 * @param {string} user
 * @param {string} pveHost
 * @param {number} vmid
 */
export async function upgradeNagiosInCt(user, pveHost, vmid) {
  return installNagiosInCt(user, pveHost, vmid, { upgrade: true });
}

/**
 * @param {string} user
 * @param {string} pveHost
 * @param {number} vmid
 */
export function readCtPrimaryIp(user, pveHost, vmid) {
  const r = pctExec(user, pveHost, vmid, "hostname -I 2>/dev/null | awk '{print $1}'", {
    capture: true,
  });
  if (r.status !== 0) return null;
  const ip = r.stdout.trim().split(/\s+/)[0];
  return ip && /^\d{1,3}(\.\d{1,3}){3}$/.test(ip) ? ip : null;
}
