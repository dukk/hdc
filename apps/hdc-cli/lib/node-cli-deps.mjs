import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { existsSync, readFileSync } from "node:fs";
import { basename, join, relative, resolve, isAbsolute } from "node:path";
import { stdin as input, stderr as rlOutput } from "node:process";
import { loadDotenv } from "../env.mjs";
import { defaultHostProbe } from "./host-probe.mjs";
import { clumpsDir, repoRoot } from "../paths.mjs";
import { primaryClumpsRoot } from "../manifests.mjs";
import { defaultVaultPath } from "../vault.mjs";
import { readLineMasked } from "./readline-masked.mjs";

/**
 * Operator-facing command prefix for help text and reports.
 * Normalizes wrapper invocations (hdc.cmd, ./hdc) to `hdc`.
 * @returns {string}
 */
export function computeCliInvocationForHelp() {
  const fromEnv = String(process.env.HDC_CLI_INVOCATION ?? "").trim();
  if (fromEnv) {
    const normalized = fromEnv.replace(/\\/g, "/");
    const base = basename(normalized).replace(/\.cmd$/i, "");
    if (base === "hdc") return "hdc";
    return normalized;
  }
  return "hdc";
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
