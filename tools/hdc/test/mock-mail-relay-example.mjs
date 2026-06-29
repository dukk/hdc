import { readFileSync } from "node:fs";
import { join } from "node:path";
import { vi } from "vitest";

import * as packageRunConfig from "../../../packages/lib/package-run-config.mjs";
import { resetMailRelayClientDefaultsCache } from "../../../packages/lib/mail-relay-config.mjs";
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

  const examplePath = join(repoRoot(), "packages/services/postfix-relay/config.example.json");
  const exampleData = JSON.parse(readFileSync(examplePath, "utf8"));
  const original = packageRunConfig.loadPackageConfigFromPackageRoot;

  activeSpy = vi.spyOn(packageRunConfig, "loadPackageConfigFromPackageRoot").mockImplementation((packageRoot, opts) => {
    const norm = String(packageRoot).replace(/\\/g, "/");
    if (norm.endsWith("packages/services/postfix-relay")) {
      return {
        path: examplePath,
        source: "public",
        data: exampleData,
      };
    }
    return original(packageRoot, opts);
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
