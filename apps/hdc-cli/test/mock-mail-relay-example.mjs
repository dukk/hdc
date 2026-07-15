import { readFileSync } from "node:fs";
import { join } from "node:path";
import { vi } from "vitest";

import * as packageRunConfig from "hdc/package/clump-run-config.mjs";
import { clumpPath } from "hdc/package/clumps-root.mjs";
import { resetMailRelayClientDefaultsCache } from "hdc/package/mail-relay-config.mjs";

/** @type {import("vitest").MockInstance | null} */
let activeSpy = null;

/**
 * Force mail-relay tests to use public config.example.json (not hdc-private config.json).
 */
export function installMailRelayExampleMock() {
  if (activeSpy) {
    activeSpy.mockRestore();
    activeSpy = null;
  }
  resetMailRelayClientDefaultsCache();

  const examplePath = clumpPath("services/postfix-relay/config.example.json");
  const exampleData = JSON.parse(readFileSync(examplePath, "utf8"));
  const original = packageRunConfig.loadClumpConfigFromClumpRoot;
  const relayRoot = clumpPath("services/postfix-relay").replace(/\\/g, "/");

  activeSpy = vi.spyOn(packageRunConfig, "loadClumpConfigFromClumpRoot").mockImplementation((clumpRoot, opts) => {
    const norm = String(clumpRoot).replace(/\\/g, "/");
    if (norm.endsWith("services/postfix-relay") || norm === relayRoot) {
      return {
        path: examplePath,
        source: "public",
        data: exampleData,
      };
    }
    return original(clumpRoot, opts);
  });
  resetMailRelayClientDefaultsCache();
  return activeSpy;
}

export function restoreMailRelayExampleMock() {
  if (activeSpy) {
    activeSpy.mockRestore();
    activeSpy = null;
  }
  resetMailRelayClientDefaultsCache();
}
