import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Repository root (parent of `apps/hdc-cli/`). */
export function repoRoot() {
  return join(__dirname, "..", "..");
}

/** HDC CLI app directory. */
export function cliAppDir(root = repoRoot()) {
  return join(root, "apps", "hdc-cli");
}

/** HDC clumps under `clumps/{infrastructure,services,clients}/`. */
export function clumpsDir(root = repoRoot()) {
  return join(root, "clumps");
}

export function manuallyDeployedDir(root = repoRoot()) {
  return join(root, "docs", "manually-deployed");
}
