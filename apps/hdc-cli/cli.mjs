#!/usr/bin/env node
/**
 * HDC CLI — single entry (Node 18+, runtime has no npm deps; devDependencies supply tests).
 * Usage: hdc <command> [args] — help text uses `hdc` (see HDC_CLI_INVOCATION / hdc wrappers).
 */
import { register } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const cliDir = dirname(fileURLToPath(import.meta.url));
register("./lib/package/import-hook.mjs", import.meta.url);

const { runCli } = await import("./lib/cli-app.mjs");
const { createNodeCliDeps } = await import("./lib/node-cli-deps.mjs");

runCli(process.argv.slice(2), createNodeCliDeps())
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
