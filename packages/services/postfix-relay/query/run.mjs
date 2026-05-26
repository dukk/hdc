#!/usr/bin/env node
/**
 * Query Postfix relay deployment config (and optional live status with --live).
 */
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stderr as errout } from "node:process";

import { deployTargetInventory, logDeployInventoryStatus } from "../../../lib/deploy-inventory.mjs";
import { tryLoadPackageConfigFromPackageRoot } from "../../../lib/package-run-config.mjs";
import { parseArgvFlags, flagGet } from "../../../lib/parse-argv-flags.mjs";
import { repoRoot } from "../../../../tools/hdc/paths.mjs";
import { formatResolvedRepoFileLabel } from "../../../../tools/hdc/lib/private-repo.mjs";
import { resolvePveSshForHost } from "../../ollama/lib/ollama-install.mjs";
import { pctExec } from "../lib/remote.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const target = basename(dirname(here));
const verb = basename(here);
const packageRoot = join(here, "..");
const PACKAGE_CONFIG_EXAMPLE = "packages/services/postfix-relay/config.example.json";
const root = repoRoot();
const proxmoxRoot = join(root, "packages", "infrastructure", "proxmox");

const inv = deployTargetInventory(root, target);
logDeployInventoryStatus(target, verb, inv);

/** @param {unknown} v */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

const loaded = tryLoadPackageConfigFromPackageRoot(packageRoot, {});
const cfg = loaded.ok && isObject(loaded.data) ? loaded.data : null;
const configLabel = loaded.ok
  ? formatResolvedRepoFileLabel(loaded.resolved, root)
  : loaded.rel ?? "packages/services/postfix-relay/config.json";

const mode = cfg && isObject(cfg.deploy) && typeof cfg.deploy.mode === "string" ? cfg.deploy.mode : null;
const relayhost =
  cfg && isObject(cfg.smtp) && typeof cfg.smtp.relayhost === "string" ? cfg.smtp.relayhost : null;

errout.write(`[hdc] ${target} ${verb}: config ${configLabel} ${loaded.ok ? "loaded" : "not loaded"}.\n`);

const flags = parseArgvFlags(process.argv.slice(2));
const live = flagGet(flags, "live") !== undefined;

/** @type {Record<string, unknown> | null} */
let liveStatus = null;

if (live && cfg && isObject(cfg.proxmox)) {
  const px = cfg.proxmox;
  const hostId = typeof px.host_id === "string" ? px.host_id.trim() : "";
  const lxc = isObject(px.lxc) ? px.lxc : {};
  const vmid = typeof lxc.vmid === "number" ? lxc.vmid : Number(lxc.vmid);
  if (hostId && Number.isFinite(vmid) && vmid > 0) {
    try {
      const pveSsh = resolvePveSshForHost(proxmoxRoot, hostId);
      const svc = pctExec(pveSsh.user, pveSsh.host, vmid, "systemctl is-active postfix 2>/dev/null", {
        capture: true,
      });
      const relay = pctExec(
        pveSsh.user,
        pveSsh.host,
        vmid,
        "postconf -n relayhost 2>/dev/null || postconf relayhost 2>/dev/null",
        { capture: true },
      );
      liveStatus = {
        postfix_active: svc.stdout.trim(),
        relayhost: relay.stdout.trim() || null,
      };
    } catch (e) {
      liveStatus = { error: String(/** @type {Error} */ (e).message || e) };
    }
  }
}

const payload = {
  target,
  verb: "query",
  ok: Boolean(cfg && inv.ready),
  system_id: inv.systemId,
  config_path: configLabel,
  config_source: loaded.ok ? loaded.source : null,
  deploy_mode: mode,
  relayhost,
  live: live ? liveStatus : undefined,
  message: cfg
    ? `Postfix relay config present (deploy.mode=${JSON.stringify(mode)}).`
    : `Copy packages/services/postfix-relay/config.example.json to hdc-private config.json`,
};
process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
