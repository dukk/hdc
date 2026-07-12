import { spawnSync } from "node:child_process";
import { devNull } from "node:os";

import {
  FALLBACK_BOOTSTRAP_SSH_USER,
  resolveGuestSshUser,
} from "./guest-ssh-resolve.mjs";
import { sshRemote } from "./pve-pct-remote.mjs";

const SSH_OPTS = [
  "-o",
  "BatchMode=yes",
  "-o",
  "StrictHostKeyChecking=accept-new",
  "-o",
  `UserKnownHostsFile=${devNull}`,
  "-o",
  "ConnectTimeout=10",
];

/**
 * @param {string} s
 */
function shellQuote(s) {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * @param {string} user
 * @param {string} host
 * @returns {boolean}
 */
export function probeGuestSshUser(user, host) {
  const r = spawnSync(
    "ssh",
    [...SSH_OPTS, `${user}@${host}`, "true"],
    { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  );
  return (r.status ?? 1) === 0;
}

/**
 * @param {object} opts
 * @param {string} opts.host
 * @param {string} [opts.preferredUser]
 * @param {string} [opts.fallbackUser]
 * @param {(line: string) => void} [opts.log]
 * @returns {{ user: string; host: string; fallback_used: boolean }}
 */
export function resolveGuestSshTargetWithFallback(opts) {
  const host = opts.host.trim();
  const preferred = opts.preferredUser?.trim() || FALLBACK_BOOTSTRAP_SSH_USER;
  const fallback = opts.fallbackUser?.trim() || FALLBACK_BOOTSTRAP_SSH_USER;
  const log = opts.log ?? (() => {});

  if (probeGuestSshUser(preferred, host)) {
    return { user: preferred, host, fallback_used: false };
  }
  if (preferred !== fallback && probeGuestSshUser(fallback, host)) {
    log(`SSH fallback: ${preferred}@${host} unavailable — using ${fallback}`);
    return { user: fallback, host, fallback_used: true };
  }
  return { user: preferred, host, fallback_used: false };
}

/**
 * Wrap inner shell for non-root SSH users (passwordless sudo).
 * @param {string} inner
 * @param {string} effectiveUser
 * @returns {string}
 */
export function wrapRemoteShellForSshUser(inner, effectiveUser) {
  if (effectiveUser === "root") {
    return inner;
  }
  return `sudo -n bash -lc ${shellQuote(inner)}`;
}

/**
 * @typedef {import("./clamav-ensure.mjs").ConfigureExec} ConfigureExec
 */

/**
 * @param {object} opts
 * @param {string} opts.host
 * @param {unknown} [opts.configuredUser]
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {boolean} [opts.useFallback]
 * @param {(line: string) => void} [opts.log]
 * @returns {ConfigureExec & { effectiveUser: string; fallback_used: boolean }}
 */
export function createGuestSshExec(opts) {
  const host = opts.host.trim();
  const preferredUser = resolveGuestSshUser(opts.configuredUser, opts.env);
  const useFallback = opts.useFallback !== false;
  const log = opts.log ?? (() => {});

  let effectiveUser = preferredUser;
  let fallback_used = false;
  if (useFallback) {
    const resolved = resolveGuestSshTargetWithFallback({
      host,
      preferredUser,
      fallbackUser: FALLBACK_BOOTSTRAP_SSH_USER,
      log,
    });
    effectiveUser = resolved.user;
    fallback_used = resolved.fallback_used;
  }

  return {
    effectiveUser,
    fallback_used,
    label: `ssh ${effectiveUser}@${host}`,
    run: (inner, runOpts) => {
      const wrapped = wrapRemoteShellForSshUser(inner, effectiveUser);
      return sshRemote(effectiveUser, host, `bash -lc ${shellQuote(wrapped)}`, runOpts);
    },
  };
}
