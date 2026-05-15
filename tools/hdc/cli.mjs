#!/usr/bin/env node
/**
 * HDC CLI — single entry (Node 18+, runtime has no npm deps; devDependencies supply tests).
 * Usage: node tools/hdc/cli.mjs <command> [args] — help text uses the same prefix you used (see HDC_CLI_INVOCATION / hdc wrappers).
 */
import { runCli } from "./lib/cli-app.mjs";
import { createNodeCliDeps } from "./lib/node-cli-deps.mjs";

runCli(process.argv.slice(2), createNodeCliDeps())
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
