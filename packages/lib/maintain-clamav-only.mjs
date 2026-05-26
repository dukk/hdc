import { join } from "node:path";

import { tryLoadPackageConfigFromPackageRoot } from "../../tools/hdc/lib/package-config.mjs";

import { ensureGuestLinuxBaseline } from "./guest-linux-baseline.mjs";
import { createPackageVaultAccess } from "./package-vault-access.mjs";
import { provisionLogFromConsole } from "./host-provisioner.mjs";
import { parseArgvFlags } from "./parse-argv-flags.mjs";
import { createConfigureExec } from "../services/postfix-relay/lib/postfix-relay-configure.mjs";
import { runOperationReportTail } from "./operation-report.mjs";

/** @param {unknown} v */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * @param {unknown} configure
 * @returns {{ user: string; host: string } | null}
 */
export function sshTargetFromConfigure(configure) {
  if (!isObject(configure)) return null;
  const ssh = isObject(configure.ssh) ? configure.ssh : {};
  const user = typeof ssh.user === "string" && ssh.user.trim() ? ssh.user.trim() : "root";
  const host = typeof ssh.host === "string" && ssh.host.trim() ? ssh.host.trim() : "";
  if (!host) return null;
  return { user, host };
}

/**
 * Collect SSH targets from package config (deployments[] or top-level configure).
 * @param {Record<string, unknown>} cfg
 * @returns {{ systemId: string; user: string; host: string }[]}
 */
export function listSshTargetsFromPackageConfig(cfg) {
  /** @type {{ systemId: string; user: string; host: string }[]} */
  const out = [];
  const seen = new Set();

  if (Array.isArray(cfg.deployments)) {
    for (const raw of cfg.deployments) {
      if (!isObject(raw)) continue;
      const sid =
        typeof raw.system_id === "string" && raw.system_id.trim()
          ? raw.system_id.trim()
          : "unknown";
      const t = sshTargetFromConfigure(raw.configure);
      if (!t) continue;
      const key = `${t.user}@${t.host}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ systemId: sid, ...t });
    }
  }

  const top = sshTargetFromConfigure(cfg.configure);
  if (top) {
    const sid =
      isObject(cfg.deploy) && typeof cfg.deploy.system_id === "string"
        ? cfg.deploy.system_id.trim()
        : "default";
    const key = `${top.user}@${top.host}`;
    if (!seen.has(key)) {
      out.push({ systemId: sid, ...top });
    }
  }

  return out;
}

/**
 * @param {object} opts
 * @param {string} opts.target Package id (manifest)
 * @param {string} opts.verb maintain
 * @param {string} opts.packageRoot packages/services/<id>
 * @param {string} opts.root Repo root
 * @param {string} [opts.cfgFileName] Default config.json
 * @param {(cfg: Record<string, unknown>, flags: Record<string, string>) => Promise<{ systemId: string; exec: import("./clamav-ensure.mjs").ConfigureExec }[]>} [opts.resolveExecTargets] Custom resolver (e.g. LXC pct)
 */
export async function runClamavOnlyMaintain(opts) {
  const { target, verb, packageRoot, root } = opts;
  const loaded = tryLoadPackageConfigFromPackageRoot(packageRoot, {
    filename: opts.cfgFileName ?? "config.json",
    publicRoot: root,
  });
  const flags = parseArgvFlags(process.argv.slice(2));
  const log = provisionLogFromConsole(console);

  if (!loaded.ok || !loaded.data) {
    const payload = {
      ok: true,
      target,
      verb,
      message: "package config missing — guest baseline not applied",
      results: [],
    };
    runOperationReportTail({
      packageRoot,
      repoRoot: root,
      verb,
      argv: process.argv.slice(2),
      payload,
      ok: true,
      log: (line) => process.stderr.write(`[hdc] ${target} ${verb}: ${line}\n`),
    });
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  const cfg = loaded.data;
  /** @type {{ systemId: string; exec: import("./clamav-ensure.mjs").ConfigureExec }[]} */
  let targets = [];
  if (opts.resolveExecTargets) {
    targets = await opts.resolveExecTargets(cfg, flags);
  } else {
    const sshList = listSshTargetsFromPackageConfig(cfg);
    targets = sshList.map(({ systemId, user, host }) => ({
      systemId,
      exec: createConfigureExec("ssh", { user, host }),
    }));
  }

  if (targets.length === 0) {
    const payload = {
      ok: true,
      target,
      verb,
      message: "no SSH or LXC targets in config — guest baseline not applied",
      results: [],
    };
    runOperationReportTail({
      packageRoot,
      repoRoot: root,
      verb,
      argv: process.argv.slice(2),
      payload,
      ok: true,
      log: (line) => process.stderr.write(`[hdc] ${target} ${verb}: ${line}\n`),
    });
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  const vaultAccess = createPackageVaultAccess();
  await vaultAccess.unlock({});

  /** @type {Record<string, unknown>[]} */
  const results = [];
  for (const { systemId, exec } of targets) {
    process.stderr.write(`[hdc] ${target} ${verb}: guest baseline on ${systemId} (${exec.label}) …\n`);
    try {
      const baseline = await ensureGuestLinuxBaseline({ exec, log, flags, vaultAccess });
      results.push({
        ok: baseline.ok,
        system_id: systemId,
        admin_user: baseline.admin_user,
        clamav: baseline.clamav,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({ ok: false, system_id: systemId, message: msg });
    }
  }

  const ok = results.every((r) => r.ok);
  const payload = { ok, target, verb, results, generated_at: new Date().toISOString() };
  runOperationReportTail({
    packageRoot,
    repoRoot: root,
    verb,
    argv: process.argv.slice(2),
    payload,
    ok,
    log: (line) => process.stderr.write(`[hdc] ${target} ${verb}: ${line}\n`),
  });
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exitCode = ok ? 0 : 1;
}
