import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { existsSync, readFileSync } from "node:fs";
import { basename, join, relative, resolve, isAbsolute } from "node:path";
import { cwd, stdin as input, stderr as rlOutput } from "node:process";
import { loadDotenv } from "../env.mjs";
import { defaultHostProbe } from "./host-probe.mjs";
import { clumpsDir, repoRoot } from "../paths.mjs";
import { primaryClumpsRoot } from "../manifests.mjs";
import { defaultVaultPath } from "../vault.mjs";
import { readLineMasked } from "./readline-masked.mjs";

/**
 * Command prefix for help text: wrapper sets HDC_CLI_INVOCATION; otherwise `node <script path>`.
 * @returns {string}
 */
export function computeCliInvocationForHelp() {
  const fromEnv = String(process.env.HDC_CLI_INVOCATION ?? "").trim();
  if (fromEnv) return fromEnv.replace(/\\/g, "/");

  const script = process.argv[1];
  if (!script) return "node apps/hdc-cli/cli.mjs";

  const resolved = resolve(script);
  let scriptPart = relative(cwd(), resolved);
  if (!scriptPart || scriptPart.startsWith("..")) scriptPart = resolved;
  const normalizedScript = String(scriptPart).replace(/\\/g, "/");

  const exeBase = basename(process.execPath).replace(/\.exe$/i, "").toLowerCase();
  const nodeToken =
    exeBase === "node" ? "node" : String(process.execPath).replace(/\\/g, "/");

  return `${nodeToken} ${normalizedScript}`.trim();
}

/**
 * Production wiring: Node stdio, real FS, real spawn.
 * @returns {import("./cli-app.mjs").CliDeps}
 */
export function createNodeCliDeps() {
  return {
    env: process.env,
    log: (...a) => console.log(...a),
    error: (...a) => console.error(...a),
    warn: (...a) => console.warn(...a),
    repoRoot,
    clumpsDir: (root) => primaryClumpsRoot(root, process.env),
    join,
    resolve,
    isAbsolute,
    relative,
    existsSync,
    readFileSync,
    spawnSync,
    execPath: process.execPath,
    loadDotenv,
    defaultVaultPath,
    readStdinUtf8: () => readFileSync(0, "utf8"),
    readLineQuestion: async (q, opts) => {
      // Prompts must go to stderr: `hdc run … query` pipes child stdout; questions on stdout would be invisible.
      if (opts?.mask) {
        return readLineMasked(q, rlOutput, input);
      }
      const rl = createInterface({ input, output: rlOutput });
      try {
        return await rl.question(q);
      } finally {
        rl.close();
      }
    },
    cliInvocationForHelp: computeCliInvocationForHelp,
    stdoutWrite: (s) => {
      process.stdout.write(s);
    },
    hostProbe: defaultHostProbe,
  };
}
