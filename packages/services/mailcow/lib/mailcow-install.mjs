import { stderr as errout } from "node:process";

import { pctExec } from "../../../lib/pve-pct-remote.mjs";
import { waitForCt } from "../../ollama/lib/ollama-install.mjs";
import { resolvePveSshForHost } from "../../pi-hole/lib/pi-hole-install.mjs";
import {
  buildComposeDownScript,
  buildGenerateConfigEnv,
  buildInstallScript,
  buildMaintainScript,
  buildReverseProxyConfScript,
  installDir,
  normalizeGitRef,
  resolveAdminUrl,
} from "./mailcow-render.mjs";
import {
  buildMailcowDataDiskMountScript,
  MAILCOW_DATA_MOUNT,
  MAILCOW_DOCKER_DATA_ROOT,
} from "./proxmox-data-disk.mjs";

export { resolvePveSshForHost };

/**
 * @param {string} user
 * @param {string} pveHost
 * @param {number} vmid
 */
export function readCtPrimaryIp(user, pveHost, vmid) {
  const r = pctExec(user, pveHost, vmid, "hostname -I | awk '{print $1}'", { capture: true });
  if (r.status !== 0) return null;
  const ip = r.stdout.trim().split(/\s+/)[0];
  return ip || null;
}

/**
 * @param {import("../../postfix-relay/lib/postfix-relay-configure.mjs").ConfigureExec} exec
 * @param {Record<string, unknown>} mailcow
 * @param {Record<string, unknown>} install
 * @param {{ dbpass: string; dbroot: string; redispass: string }} secrets
 * @param {number} [dataDiskGb]
 */
export async function installMailcowOnHost(exec, mailcow, install, secrets, dataDiskGb = 0) {
  errout.write(`[hdc] mailcow install: mailcow-dockerized via ${exec.label} …\n`);

  const dir = installDir(install);
  const gitRef = normalizeGitRef(mailcow);
  const genEnv = buildGenerateConfigEnv(mailcow, secrets);
  const useDataDisk = dataDiskGb > 0;
  const inner = buildInstallScript(dir, gitRef, genEnv, {
    dataDiskMountScript: useDataDisk ? buildMailcowDataDiskMountScript(MAILCOW_DATA_MOUNT) : undefined,
    dockerDataRoot: useDataDisk ? MAILCOW_DOCKER_DATA_ROOT : undefined,
  });

  const r = exec.run(inner);
  if (r.status !== 0) {
    return {
      ok: false,
      method: "mailcow-dockerized",
      message: `install failed (exit ${r.status})`,
      detail: `${r.stderr}${r.stdout}`.trim() || null,
    };
  }

  const ipOut = exec.run("hostname -I | awk '{print $1}'");
  const guestIp = ipOut.status === 0 ? ipOut.stdout.trim().split(/\s+/)[0] || null : null;
  errout.write(`[hdc] mailcow install: completed on ${guestIp ?? "guest"}.\n`);
  return {
    ok: true,
    method: "mailcow-dockerized",
    message: "installed",
    admin_url: resolveAdminUrl(mailcow),
    guest_ip: guestIp,
  };
}

/**
 * @param {string} user
 * @param {string} pveHost
 * @param {number} vmid
 * @param {Record<string, unknown>} mailcow
 * @param {Record<string, unknown>} install
 * @param {{ dbpass: string; dbroot: string; redispass: string }} secrets
 */
export async function installMailcowInCt(user, pveHost, vmid, mailcow, install, secrets) {
  errout.write(`[hdc] mailcow install: mailcow-dockerized in CT ${vmid} …\n`);

  const ready = await waitForCt(user, pveHost, vmid, 2000, "mailcow install");
  if (!ready) {
    return { ok: false, method: "mailcow-dockerized", message: `CT ${vmid} not reachable via pct exec` };
  }

  const dir = installDir(install);
  const gitRef = normalizeGitRef(mailcow);
  const genEnv = buildGenerateConfigEnv(mailcow, secrets);
  const inner = buildInstallScript(dir, gitRef, genEnv);

  const r = pctExec(user, pveHost, vmid, inner);
  if (r.status !== 0) {
    return {
      ok: false,
      method: "mailcow-dockerized",
      message: `install failed (exit ${r.status})`,
    };
  }

  const ip = readCtPrimaryIp(user, pveHost, vmid);
  errout.write(`[hdc] mailcow install: completed on CT ${vmid}.\n`);
  return {
    ok: true,
    method: "mailcow-dockerized",
    message: "installed",
    admin_url: resolveAdminUrl(mailcow),
    ct_ip: ip,
    guest_ip: ip,
  };
}

/**
 * @param {import("../../postfix-relay/lib/postfix-relay-configure.mjs").ConfigureExec} exec
 * @param {Record<string, unknown>} mailcow
 * @param {Record<string, unknown>} install
 * @param {{ skipUpgrade?: boolean }} [opts]
 */
export async function maintainMailcowStackOnHost(exec, mailcow, install, opts = {}) {
  errout.write(`[hdc] mailcow maintain: refreshing stack via ${exec.label} …\n`);

  const dir = installDir(install);
  const reverseProxy = buildReverseProxyConfScript(dir, mailcow);
  if (reverseProxy) {
    errout.write(`[hdc] mailcow maintain: applying reverse-proxy settings in mailcow.conf …\n`);
    const rpResult = exec.run(reverseProxy);
    if (rpResult.status !== 0) {
      return {
        ok: false,
        message: `reverse-proxy mailcow.conf update failed (exit ${rpResult.status})`,
      };
    }
  }
  const inner = buildMaintainScript(dir, opts);
  const r = exec.run(inner);
  if (r.status !== 0) {
    return { ok: false, message: `stack maintain failed (exit ${r.status})` };
  }
  const ipOut = exec.run("hostname -I | awk '{print $1}'");
  const guestIp = ipOut.status === 0 ? ipOut.stdout.trim().split(/\s+/)[0] || null : null;
  return {
    ok: true,
    message: opts.skipUpgrade ? "restarted" : "images refreshed",
    admin_url: resolveAdminUrl(mailcow),
    guest_ip: guestIp,
    ct_ip: guestIp,
  };
}

/**
 * @param {string} user
 * @param {string} pveHost
 * @param {number} vmid
 * @param {Record<string, unknown>} mailcow
 * @param {Record<string, unknown>} install
 * @param {{ skipUpgrade?: boolean }} [opts]
 */
export async function maintainMailcowStackInCt(user, pveHost, vmid, mailcow, install, opts = {}) {
  errout.write(`[hdc] mailcow maintain: refreshing stack in CT ${vmid} …\n`);

  const ready = await waitForCt(user, pveHost, vmid, 2000, "mailcow maintain");
  if (!ready) {
    return { ok: false, message: `CT ${vmid} not reachable via pct exec` };
  }

  const dir = installDir(install);
  const inner = buildMaintainScript(dir, opts);
  const r = pctExec(user, pveHost, vmid, inner);
  if (r.status !== 0) {
    return { ok: false, message: `stack maintain failed (exit ${r.status})` };
  }
  const ip = readCtPrimaryIp(user, pveHost, vmid);
  return {
    ok: true,
    message: opts.skipUpgrade ? "restarted" : "images refreshed",
    admin_url: resolveAdminUrl(mailcow),
    ct_ip: ip,
    guest_ip: ip,
  };
}

/**
 * @param {import("../../postfix-relay/lib/postfix-relay-configure.mjs").ConfigureExec} exec
 * @param {Record<string, unknown>} install
 */
export function composeDownOnHost(exec, install) {
  const dir = installDir(install);
  const inner = buildComposeDownScript(dir);
  exec.run(inner);
}

/**
 * @param {string} user
 * @param {string} pveHost
 * @param {number} vmid
 * @param {Record<string, unknown>} install
 */
export function composeDownInCt(user, pveHost, vmid, install) {
  const dir = installDir(install);
  const inner = buildComposeDownScript(dir);
  pctExec(user, pveHost, vmid, inner);
}
