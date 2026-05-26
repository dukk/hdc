#!/usr/bin/env node
/**
 * Query Raspberry Pi OS hosts (disk, upgradable package count).
 *
 * Usage: hdc run client raspberrypi query -- [--host-id <id>] [--no-wol]
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { runClientVerb } from "../../lib/client-run.mjs";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
await runClientVerb({ platform: "raspberrypi", verb: "query", packageRoot, argv: process.argv.slice(2) });
