#!/usr/bin/env node
/**
 * Health check for azure-compute (layered DNS / WAF / direct / guest).
 *
 * Usage: hdc run azure-compute health -- [--instance a]
 */
import { runServiceHealth, clumpRootFromHealthScript } from "../../../lib/service-health/run-health.mjs";

const payload = await runServiceHealth({
  clumpRoot: clumpRootFromHealthScript(import.meta.url),
  packageId: "azure-compute",
  family: "infra-api",
});
process.exit(payload.ok ? 0 : 1);
