import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Repository root (parent of `tools/`). */
export function repoRoot() {
  return join(__dirname, "..", "..");
}

/** HDC packages under `packages/infrastructure/` and `packages/services/`. */
export function packagesDir(root = repoRoot()) {
  return join(root, "packages");
}

export function manuallyDeployedDir(root = repoRoot()) {
  return join(root, "docs", "manually-deployed");
}
