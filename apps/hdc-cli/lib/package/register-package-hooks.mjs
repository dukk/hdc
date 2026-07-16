import * as nodeModule from "node:module";

import { resolve } from "./import-hook.mjs";

/**
 * Register hdc/package|cli|clump specifier remapping.
 * Prefers sync `registerHooks` (Node ≥22.15 / 23.5) to avoid DEP0205;
 * falls back to legacy `register()` on older runtimes.
 *
 * @param {string | URL} [parentURL] Parent URL for legacy `register()` only (default: this module)
 */
export function registerPackageHooks(parentURL = import.meta.url) {
  if (typeof nodeModule.registerHooks === "function") {
    nodeModule.registerHooks({ resolve });
    return;
  }
  nodeModule.register("./import-hook.mjs", parentURL);
}
