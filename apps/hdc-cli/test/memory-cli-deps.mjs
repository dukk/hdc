import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve, isAbsolute } from "node:path";

/**
 * @typedef {object} MemoryCliCapture
 * @property {string[]} logLines
 * @property {string[]} errorLines
 * @property {string[]} warnLines
 * @property {string[]} [stdoutChunks]
 */

/**
 * @typedef {object} MemoryCliDepsOptions
 * @property {string} root
 * @property {MemoryCliCapture} [capture]
 * @property {Record<string, string | undefined>} [envVars]
 * @property {import("../lib/cli-app.mjs").CliDeps["spawnSync"]} [spawnSync]
 * @property {import("../lib/cli-app.mjs").CliDeps["existsSync"]} [existsSync]
 * @property {import("../lib/cli-app.mjs").CliDeps["readFileSync"]} [readFileSync]
 * @property {import("../lib/cli-app.mjs").CliDeps["loadDotenv"]} [loadDotenv]
 * @property {import("../lib/cli-app.mjs").CliDeps["defaultVaultPath"]} [defaultVaultPath]
 * @property {import("../lib/cli-app.mjs").CliDeps["readStdinUtf8"]} [readStdinUtf8]
 * @property {import("../lib/cli-app.mjs").CliDeps["readLineQuestion"]} [readLineQuestion]
 * @property {import("../lib/cli-app.mjs").CliDeps["clumpsDir"]} [clumpsDir]
 * @property {import("../lib/cli-app.mjs").CliDeps["execPath"]} [execPath]
 * @property {import("../lib/cli-app.mjs").CliDeps["cliInvocationForHelp"]} [cliInvocationForHelp]
 * @property {import("../lib/cli-app.mjs").CliDeps["stdoutWrite"]} [stdoutWrite]
 * @property {import("../lib/cli-app.mjs").CliDeps["hostProbe"]} [hostProbe]
 */

/**
 * @param {MemoryCliDepsOptions} opts
 * @returns {import("../lib/cli-app.mjs").CliDeps}
 */
export function createMemoryCliDeps(opts) {
  const capture = opts.capture ?? {
    logLines: [],
    errorLines: [],
    warnLines: [],
    stdoutChunks: [],
  };
  const env = {
    ...process.env,
    HDC_CLUMPS_ROOT: join(opts.root, "clumps"),
    HDC_CLUMPS_CACHE: join(opts.root, ".clump-cache"),
    ...opts.envVars,
  };
  return {
    env,
    log: (...a) => {
      capture.logLines.push(a.map(String).join(" "));
    },
    error: (...a) => {
      capture.errorLines.push(a.map(String).join(" "));
    },
    warn: (...a) => {
      capture.warnLines.push(a.map(String).join(" "));
    },
    repoRoot: () => opts.root,
    clumpsDir: opts.clumpsDir ?? ((r) => join(r, "clumps")),
    join,
    resolve,
    isAbsolute,
    relative,
    existsSync: opts.existsSync ?? existsSync,
    readFileSync: opts.readFileSync ?? readFileSync,
    spawnSync: opts.spawnSync ?? spawnSync,
    execPath: opts.execPath ?? process.execPath,
    loadDotenv: opts.loadDotenv ?? (() => {}),
    defaultVaultPath: opts.defaultVaultPath ?? (() => join(opts.root, ".vault.enc")),
    readStdinUtf8: opts.readStdinUtf8 ?? (() => ""),
    readLineQuestion: opts.readLineQuestion ?? (async (_q, _opts) => ""),
    cliInvocationForHelp: opts.cliInvocationForHelp ?? (() => "node apps/hdc-cli/cli.mjs"),
    stdoutWrite:
      opts.stdoutWrite ??
      ((s) => {
        if (!capture.stdoutChunks) capture.stdoutChunks = [];
        capture.stdoutChunks.push(s);
      }),
    hostProbe:
      opts.hostProbe ??
      (() => ({
        hostname: "test-host",
        ips: [],
        platform: "linux",
        arch: "x64",
      })),
  };
}
