import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadClumpsReposConfig } from "./lib/clump-repos.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Repository root (parent of `apps/hdc-cli/`). */
export function repoRoot() {
  return join(__dirname, "..", "..");
}

/** HDC CLI app directory. */
export function cliAppDir(root = repoRoot()) {
  return join(root, "apps", "hdc-cli");
}

/** Shared package runtime under hdc-cli (former clumps/lib). */
export function packageLibDir(root = repoRoot()) {
  return join(cliAppDir(root), "lib", "package");
}

/** HDC clumps under `clumps/{infrastructure,services,clients}/` (legacy in-tree path). */
export function clumpsDir(root = repoRoot()) {
  return join(root, "clumps");
}

/** Default external clump cache directory. */
export function defaultClumpsCacheDir(root = repoRoot(), env = process.env) {
  return loadClumpsReposConfig(root, env).cache_dir;
}

export function manuallyDeployedDir(root = repoRoot()) {
  return join(root, "docs", "manually-deployed");
}
