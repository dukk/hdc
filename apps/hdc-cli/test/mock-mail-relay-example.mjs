import { readFileSync } from "node:fs";
import { join } from "node:path";
import { vi } from "vitest";

import * as packageRunConfig from "../../../clumps/lib/clump-run-config.mjs";
import { resetMailRelayClientDefaultsCache } from "../../../clumps/lib/mail-relay-config.mjs";
import { repoRoot } from "../paths.mjs";

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

  const examplePath = join(repoRoot(), "clumps/services/postfix-relay/config.example.json");
  const exampleData = JSON.parse(readFileSync(examplePath, "utf8"));
  const original = packageRunConfig.loadClumpConfigFromClumpRoot;

  activeSpy = vi.spyOn(packageRunConfig, "loadClumpConfigFromClumpRoot").mockImplementation((clumpRoot, opts) => {
    const norm = String(clumpRoot).replace(/\\/g, "/");
    if (norm.endsWith("clumps/services/postfix-relay")) {
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
