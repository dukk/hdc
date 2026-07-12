import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { hdcPrivateRoot } from "../../../../apps/hdc-cli/lib/private-repo.mjs";

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
 * @param {typeof spawnSync} [spawnFn]
 */
function hasRsyncOnPath(spawnFn = spawnSync) {
  const checker = process.platform === "win32" ? "where" : "which";
  const r = spawnFn(checker, ["rsync"], { encoding: "utf8", shell: true });
  return r.status === 0;
}

/**
 * tar stream over SSH when rsync is unavailable (common on Windows operators).
 *
 * @param {object} opts
 * @param {string} opts.localRoot
 * @param {string} opts.remoteDest user@host:path/
 * @param {string[]} opts.exclude
 * @param {boolean} [opts.dryRun]
 * @param {boolean} [opts.delete]
 * @param {number} [opts.port]
 * @param {typeof spawnSync} [opts.spawnSyncFn]
 */
export function tarToRemote(opts) {
  const localRoot = opts.localRoot.replace(/\\/g, "/");
  if (!existsSync(localRoot)) {
    return { ok: false, message: `local path missing: ${localRoot}`, stdout: "", stderr: "" };
  }

  const dest = String(opts.remoteDest ?? "").trim();
  const at = dest.indexOf("@");
  const colon = dest.indexOf(":", at + 1);
  if (at <= 0 || colon <= at) {
    return { ok: false, message: `invalid remoteDest ${JSON.stringify(dest)}`, stdout: "", stderr: "" };
  }
  const remoteUser = dest.slice(0, at);
  const remoteHost = dest.slice(at + 1, colon);
  const remotePath = dest.slice(colon + 1).replace(/\/$/, "");
  const port = opts.port ?? 22;
  const spawnFn = opts.spawnSyncFn ?? spawnSync;

  if (opts.dryRun) {
    return { ok: true, message: "tar dry-run ok", stdout: "", stderr: "" };
  }

  /** @type {string[]} */
  const sshBaseArgs = [
    "-p",
    String(port),
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=accept-new",
    `${remoteUser}@${remoteHost}`,
  ];

  if (opts.delete !== false) {
    const clean = spawnFn("ssh", [
      ...sshBaseArgs,
      `sudo rm -rf ${remotePath}/* ${remotePath}/.[!.]* 2>/dev/null || true`,
    ], { encoding: "utf8", shell: false });
    if (clean.status !== 0) {
      return {
        ok: false,
        message: `remote clean failed: ${`${clean.stderr}${clean.stdout}`.trim()}`,
        stdout: clean.stdout ?? "",
        stderr: clean.stderr ?? "",
      };
    }
  }

  /** @type {string[]} */
  const excludeFlags = [];
  for (const p of opts.exclude ?? []) {
    excludeFlags.push("--exclude", p);
  }

  const remoteTar = `sudo mkdir -p ${remotePath} && sudo chown -R hdc:hdc ${remotePath} && tar -xf - -C ${remotePath}`;
  const tarResult = spawnFn("tar", ["-cf", "-", ...excludeFlags, "-C", localRoot, "."], {
    encoding: "buffer",
    maxBuffer: 1024 * 1024 * 512,
    shell: false,
  });
  const tarStderr = Buffer.isBuffer(tarResult.stderr)
    ? tarResult.stderr.toString("utf8")
    : String(tarResult.stderr ?? "");
  if (tarResult.status !== 0) {
    const detail = `${tarStderr}${tarResult.stdout ?? ""}`.trim();
    return {
      ok: false,
      message: detail || `tar pack failed exit ${tarResult.status}`,
      stdout: "",
      stderr: detail,
    };
  }

  const r = spawnFn(
    "ssh",
    [...sshBaseArgs, remoteTar],
    {
      input: tarResult.stdout,
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 64,
      shell: false,
    },
  );
  const ok = r.status === 0;
  return {
    ok,
    message: ok ? "tar+ssh ok" : `${r.stderr}${r.stdout}`.trim() || `exit ${r.status}`,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
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
    args.push(
      "-e",
      `ssh -p ${opts.port} -o BatchMode=yes -o StrictHostKeyChecking=accept-new`,
    );
  } else {
    args.push("-e", "ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new");
  }
  args.push(src, opts.remoteDest);

  const spawnFn = opts.spawnSyncFn ?? spawnSync;
  if (!hasRsyncOnPath(spawnFn)) {
    return tarToRemote(opts);
  }
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

  const syncVia = hasRsyncOnPath() ? "rsync" : "tar+ssh";
  opts.log.info(`${syncVia} public hdc → ${remoteBase}:${opts.installRoot}/`);
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

  opts.log.info(`${syncVia} hdc-private → ${remoteBase}:${opts.privateRoot}/`);
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
    `chown -R hdc:hdc '${runner.install_root}' '${runner.private_root}' '${runner.meta_root}' /var/log/hdc-runner 2>/dev/null || true`,
  ].join("\n");
  const r = exec.run(script, { capture: true });
  if (r.status !== 0) {
    return { ok: false, message: `${r.stderr}${r.stdout}`.trim() || `exit ${r.status}` };
  }
  return { ok: true, message: "directories ready" };
}
