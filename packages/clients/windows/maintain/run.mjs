#!/usr/bin/env node
/**
 * Maintain Windows home clients (disk, updates via WinRM).
 *
 * Usage: hdc run client windows maintain -- [--host-id <id>] [--dry-run] [--skip-updates] [--reboot] [--no-wol]
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { runClientVerb } from "../../lib/client-run.mjs";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
await runClientVerb({ platform: "windows", verb: "maintain", packageRoot, argv: process.argv.slice(2) });
