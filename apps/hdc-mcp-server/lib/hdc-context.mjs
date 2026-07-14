import { join } from "node:path";

import { loadDotenv } from "../../hdc-cli/env.mjs";
import { bootstrapGlobalEnv } from "../../hdc-cli/lib/clump-env.mjs";
import { createNodeCliDeps } from "../../hdc-cli/lib/node-cli-deps.mjs";
import { repoRoot } from "../../hdc-cli/paths.mjs";

/**
 * @typedef {import("../../hdc-cli/lib/cli-app.mjs").CliDeps} CliDeps
 */

/**
 * @typedef {object} CaptureState
 * @property {string[]} logLines
 * @property {string[]} errorLines
 * @property {string[]} warnLines
 * @property {string} stdout
 */

/**
 * @param {CliDeps} [baseDeps]
 * @returns {{ deps: CliDeps; capture: CaptureState; resetCapture: () => void }}
 */
export function createCaptureCliDeps(baseDeps) {
  const rootDeps = baseDeps ?? createNodeCliDeps();
  /** @type {CaptureState} */
  const capture = {
    logLines: [],
    errorLines: [],
    warnLines: [],
    stdout: "",
  };

  const resetCapture = () => {
    capture.logLines.length = 0;
    capture.errorLines.length = 0;
    capture.warnLines.length = 0;
    capture.stdout = "";
  };

  const deps = {
    ...rootDeps,
    log: (...a) => {
      capture.logLines.push(a.map(String).join(" "));
    },
    error: (...a) => {
      capture.errorLines.push(a.map(String).join(" "));
    },
    warn: (...a) => {
      capture.warnLines.push(a.map(String).join(" "));
    },
    stdoutWrite: (s) => {
      capture.stdout += String(s);
    },
  };

  return { deps, capture, resetCapture };
}

let _bootstrapped = false;

/**
 * Bootstrap hdc env once per process.
 * @returns {{ deps: CliDeps; root: string; capture: CaptureState; resetCapture: () => void }}
 */
export function createHdcMcpContext() {
  const root = repoRoot();
  const { deps, capture, resetCapture } = createCaptureCliDeps();
  loadDotenv(join(root, ".env"));
  if (!_bootstrapped) {
    bootstrapGlobalEnv(deps, root);
    _bootstrapped = true;
  }
  return { deps, root, capture, resetCapture };
}

/**
 * @param {unknown} value
 * @returns {import("@modelcontextprotocol/sdk/types.js").CallToolResult}
 */
export function toolTextResult(value) {
  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return {
    content: [{ type: "text", text }],
  };
}

/**
 * @param {Error | string} err
 * @returns {import("@modelcontextprotocol/sdk/types.js").CallToolResult}
 */
export function toolErrorResult(err) {
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}
