#!/usr/bin/env node
/**
 * Ensures a local `hdc` user exists on Ubuntu hosts listed in inventory, sets its password,
 * and stores the password in the encrypted vault (see `users bootstrap-hdc`).
 */
import { createNodeCliDeps } from "../../../../tools/hdc/lib/node-cli-deps.mjs";
import { CliExit } from "../../../../tools/hdc/lib/cli-exit.mjs";
import { runUsersBootstrapHdc } from "../../../../tools/hdc/lib/users-bootstrap-hdc.mjs";

const deps = createNodeCliDeps();
runUsersBootstrapHdc(process.argv.slice(2), deps)
  .then(() => process.exit(0))
  .catch((e) => {
    if (e instanceof CliExit) process.exit(e.code);
    console.error(e);
    process.exit(1);
  });
