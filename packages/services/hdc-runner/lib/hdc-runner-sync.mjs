import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { hdcPrivateRoot } from "../../../tools/hdc/lib/private-repo.mjs";

/**
 * Build rsync exclude args from patterns.
 *
 * @param {string[]} patterns
 */
export function rsyncExcludeArgs(patterns) {
  /** @type {string[]} */
  const args = [];
  for (const p of patterns) {
    args.push("--exclude", p);
  }
  return args;
}

/**
 * @param {object} opts
 * @param {string} opts.localRoot
 * @param {string} opts.remoteDest user@host:path/
 * @param {string[]} opts.exclude
 * @param {boolean} [opts.dryRun]
 * @param {boolean} [opts.delete]
 * @param {number} [opts.port]
 * @param {typeof spawnSync} [opts.spawnSyncFn]
 */
export function rsyncToRemote(opts) {
  const localRoot = opts.localRoot.replace(/\\/g, "/");
  if (!existsSync(localRoot)) {
    return { ok: false, message: `local path missing: ${localRoot}`, stdout: "", stderr: "" };
  }

  const src = localRoot.endsWith("/") ? localRoot : `${localRoot}/`;
  /** @type {string[]} */
  const args = ["-avz", ...rsyncExcludeArgs(opts.exclude ?? [])];
  if (opts.dryRun) args.push("-n");
  if (opts.delete !== false) args.push("--delete");
  if (opts.port && opts.port !== 22) {
    args.push("-e", `ssh -p ${opts.port}`);
  }
  args.push(src, opts.remoteDest);

  const spawnFn = opts.spawnSyncFn ?? spawnSync;
  const r = spawnFn("rsync", args, { encoding: "utf8" });
  const ok = r.status === 0;
  return {
    ok,
    message: ok ? "rsync ok" : `${r.stderr}${r.stdout}`.trim() || `exit ${r.status}`,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

/**
 * Sync hdc public + private trees from operator workstation to runner guest.
 *
 * @param {object} opts
 * @param {string} opts.publicRoot
 * @param {string} opts.remoteUser
 * @param {string} opts.remoteHost
 * @param {number} [opts.remotePort]
 * @param {string} opts.installRoot
 * @param {string} opts.privateRoot
 * @param {string[]} opts.exclude
 * @param {boolean} [opts.dryRun]
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {{ info: (msg: string) => void; warn?: (msg: string) => void }} opts.log
 */
export function syncHdcTreesToGuest(opts) {
  const env = opts.env ?? process.env;
  const privateLocal = hdcPrivateRoot(opts.publicRoot, env);
  if (!privateLocal) {
    return {
      ok: false,
      message: "hdc-private not found (set HDC_PRIVATE_ROOT or clone ../hdc-private)",
      public: null,
      private: null,
    };
  }

  const remoteBase = `${opts.remoteUser}@${opts.remoteHost}`;
  const port = opts.remotePort ?? 22;

  opts.log.info(`rsync public hdc → ${remoteBase}:${opts.installRoot}/`);
  const publicResult = rsyncToRemote({
    localRoot: opts.publicRoot,
    remoteDest: `${remoteBase}:${opts.installRoot}/`,
    exclude: opts.exclude,
    dryRun: opts.dryRun,
    delete: true,
    port,
  });
  if (!publicResult.ok) {
    return { ok: false, message: publicResult.message, public: publicResult, private: null };
  }

  opts.log.info(`rsync hdc-private → ${remoteBase}:${opts.privateRoot}/`);
  const privateResult = rsyncToRemote({
    localRoot: privateLocal,
    remoteDest: `${remoteBase}:${opts.privateRoot}/`,
    exclude: opts.exclude,
    dryRun: opts.dryRun,
    delete: true,
    port,
  });

  return {
    ok: privateResult.ok,
    message: privateResult.ok ? "sync complete" : privateResult.message,
    public: publicResult,
    private: privateResult,
    private_local: privateLocal,
  };
}

/**
 * Ensure remote directories exist before rsync.
 *
 * @param {import("../../postfix-relay/lib/postfix-relay-configure.mjs").ConfigureExec} exec
 * @param {ReturnType<typeof import("./hdc-runner-settings.mjs").normalizeHdcRunnerBlock>} runner
 */
export function ensureRunnerDirectories(exec, runner) {
  const script = [
    "set -e",
    `mkdir -p '${runner.install_root}' '${runner.private_root}' '${runner.meta_root}/bin' /var/log/hdc-runner`,
    "chown -R hdc:hdc /var/log/hdc-runner 2>/dev/null || true",
  ].join("\n");
  const r = exec.run(script, { capture: true });
  if (r.status !== 0) {
    return { ok: false, message: `${r.stderr}${r.stdout}`.trim() || `exit ${r.status}` };
  }
  return { ok: true, message: "directories ready" };
}
