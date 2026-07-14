#!/usr/bin/env node
/**
 * Health check for hdc-runner (layered DNS / WAF / direct / guest).
 *
 * Usage: hdc run hdc-runner health -- [--instance a]
 */
import { runServiceHealth, clumpRootFromHealthScript } from "../../../lib/service-health/run-health.mjs";

const payload = await runServiceHealth({
  clumpRoot: clumpRootFromHealthScript(import.meta.url),
  packageId: "hdc-runner",
  family: "docker-lxc",
});
process.exit(payload.ok ? 0 : 1);
