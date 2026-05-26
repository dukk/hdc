#!/usr/bin/env node
/**
 * Maintain Ubuntu desktops (disk, apt upgrades via SSH).
 *
 * Usage: hdc run client ubuntu maintain -- [--host-id <id>] [--dry-run] [--skip-updates] [--reboot] [--no-wol]
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { runClientVerb } from "../../lib/client-run.mjs";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
await runClientVerb({ platform: "ubuntu", verb: "maintain", packageRoot, argv: process.argv.slice(2) });
