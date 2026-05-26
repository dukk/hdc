#!/usr/bin/env node
/**
 * Query Windows home clients (disk, pending updates).
 *
 * Usage: hdc run client windows query -- [--host-id <id>] [--no-wol]
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { runClientVerb } from "../../lib/client-run.mjs";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
await runClientVerb({ platform: "windows", verb: "query", packageRoot, argv: process.argv.slice(2) });
