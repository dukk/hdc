import { Buffer } from "node:buffer";
import { join } from "node:path";

import { createConfigureExec } from "../../postfix-relay/lib/postfix-relay-configure.mjs";
import { remoteInstallAuthorizedKeysForUserBash } from "../../../lib/linux-local-admin-user.mjs";
import { loadClumpConfigFromClumpRoot } from "../../../lib/clump-run-config.mjs";
import { resolveNginxWafDeployments, sshTargetFromDeployment } from "../../nginx-waf/lib/deployments.mjs";

const RUNNER_KEY_PATH = "/home/hdc/.ssh/id_ed25519";

/**
 * Ensure hdc-runner guest has an outbound SSH key for schedule jobs that SSH to peers.
 *
 * @param {import("../../postfix-relay/lib/postfix-relay-configure.mjs").ConfigureExec} exec
 * @param {{ info: (msg: string) => void }} log
 */
export function ensureRunnerOutboundSshKeyOnGuest(exec, log) {
  const script = [
    "set -euo pipefail",
    "install -d -m 700 -o hdc -g hdc /home/hdc/.ssh",
    `if [ ! -f '${RUNNER_KEY_PATH}' ]; then`,
    `  ssh-keygen -t ed25519 -N '' -f '${RUNNER_KEY_PATH}' -C 'hdc-runner-a'`,
    "  chown hdc:hdc /home/hdc/.ssh/id_ed25519 /home/hdc/.ssh/id_ed25519.pub",
    "  chmod 600 /home/hdc/.ssh/id_ed25519",
    "  chmod 644 /home/hdc/.ssh/id_ed25519.pub",
    "fi",
    `cat '${RUNNER_KEY_PATH}.pub'`,
  ].join("\n");

  log.info(`${exec.label}: ensuring runner outbound SSH key`);
  const r = exec.run(script, { capture: true });
  if (r.status !== 0) {
    const detail = `${r.stderr}${r.stdout}`.trim() || `exit ${r.status}`;
    return { ok: false, message: detail, public_key: null };
  }
  const publicKey = r.stdout.trim().split("\n").filter((line) => line.startsWith("ssh-")).pop() ?? "";
  if (!publicKey) {
    return { ok: false, message: "failed to read runner public key", public_key: null };
  }
  return { ok: true, message: "runner SSH key ready", public_key: publicKey };
}

/**
 * @param {string} publicRoot
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ user: string; host: string }[]}
 */
export function resolveNginxWafSshTargets(publicRoot, env = process.env) {
  const clumpRoot = join(publicRoot, "clumps", "services", "nginx-waf");
  try {
    const { data: cfg } = loadClumpConfigFromClumpRoot(clumpRoot, {
      publicRoot,
      env,
      exampleRel: "clumps/services/nginx-waf/config.example.json",
    });
    const deployments = resolveNginxWafDeployments(cfg, {});
    const seen = new Set();
    /** @type {{ user: string; host: string }[]} */
    const targets = [];
    for (const d of deployments) {
      const { user, host } = sshTargetFromDeployment(d);
      const key = `${user}@${host}`;
      if (!host || seen.has(key)) continue;
      seen.add(key);
      targets.push({ user, host });
    }
    return targets;
  } catch {
    return [];
  }
}

/**
 * Install runner public key on nginx-waf deployment SSH targets (from operator).
 *
 * @param {string} publicKey
 * @param {{ user: string; host: string }[]} targets
 * @param {{ info: (msg: string) => void; warn?: (msg: string) => void }} log
 */
export function installRunnerPubKeyOnSshTargets(publicKey, targets, log) {
  if (!publicKey?.trim()) {
    return { ok: true, skipped: true, message: "no runner public key", results: [] };
  }
  if (!targets.length) {
    return { ok: true, skipped: true, message: "no SSH targets", results: [] };
  }

  const keyB64 = Buffer.from(publicKey.trim(), "utf8").toString("base64");
  /** @type {Record<string, unknown>[]} */
  const results = [];

  for (const target of targets) {
    const exec = createConfigureExec("ssh", { user: target.user, host: target.host });
    const script = remoteInstallAuthorizedKeysForUserBash(target.user, [keyB64]);
    log.info(`${exec.label}: installing hdc-runner SSH public key`);
    const r = exec.run(script, { capture: true });
    const ok = r.status === 0;
    if (!ok) {
      const detail = `${r.stderr}${r.stdout}`.trim() || `exit ${r.status}`;
      log.warn?.(`${exec.label}: runner SSH key install failed: ${detail}`);
    }
    results.push({
      target: `${target.user}@${target.host}`,
      ok,
      message: ok ? "installed" : `${r.stderr}${r.stdout}`.trim() || `exit ${r.status}`,
    });
  }

  const ok = results.every((row) => row.ok === true);
  return {
    ok,
    skipped: false,
    message: ok ? `installed on ${results.length} target(s)` : "one or more targets failed",
    results,
  };
}
