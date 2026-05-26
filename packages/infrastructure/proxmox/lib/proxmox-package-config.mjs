import { repoRoot } from "../../../../tools/hdc/paths.mjs";
import {
  assertJsonObject,
  missingRepoFileError,
  readResolvedRepoJson,
  resolveRepoFile,
} from "../../../../tools/hdc/lib/private-repo.mjs";
import {
  loadPackageConfigFromPackageRoot,
  tryLoadPackageConfigFromPackageRoot,
} from "../../../../tools/hdc/lib/package-config.mjs";

const PROXMOX_CONFIG_REL = "packages/infrastructure/proxmox/config.json";

/**
 * @param {string} [publicRoot]
 */
export function proxmoxConfigRel(publicRoot = repoRoot()) {
  return PROXMOX_CONFIG_REL;
}

/**
 * @param {string} packageRoot packages/infrastructure/proxmox
 * @param {{ publicRoot?: string; env?: NodeJS.ProcessEnv; log?: (line: string) => void }} [opts]
 */
export function loadProxmoxPackageConfig(packageRoot, opts = {}) {
  const publicRoot = opts.publicRoot ?? repoRoot();
  return loadPackageConfigFromPackageRoot(packageRoot, {
    publicRoot,
    env: opts.env,
    exampleRel: PROXMOX_CONFIG_REL.replace(/config\.json$/, "config.example.json"),
    log: opts.log,
  });
}

/**
 * @param {string} packageRoot
 * @param {{ publicRoot?: string; env?: NodeJS.ProcessEnv }} [opts]
 */
export function tryLoadProxmoxPackageConfig(packageRoot, opts = {}) {
  const publicRoot = opts.publicRoot ?? repoRoot();
  return tryLoadPackageConfigFromPackageRoot(packageRoot, { publicRoot, env: opts.env });
}

/**
 * @param {string} publicRoot
 * @param {NodeJS.ProcessEnv} [env]
 */
export function resolveProxmoxConfigFile(publicRoot, env = process.env) {
  return resolveRepoFile(publicRoot, PROXMOX_CONFIG_REL, env);
}

/**
 * Resolved absolute path (public or private) when config exists.
 * @param {string} packageRoot
 * @param {{ publicRoot?: string; env?: NodeJS.ProcessEnv }} [opts]
 */
export function proxmoxConfigPath(packageRoot, opts = {}) {
  const publicRoot = opts.publicRoot ?? repoRoot();
  const resolved = resolveProxmoxConfigFile(publicRoot, opts.env);
  return resolved.found ? resolved.path : resolved.publicPath;
}

/**
 * Load config for maintain modules; return null after warn when missing/invalid.
 * @param {string} packageRoot
 * @param {(line: string) => void} warn
 * @param {string} skipLabel e.g. "API token maintain"
 * @param {{ missingOk?: boolean }} [opts]
 */
/**
 * @param {string} [publicRoot]
 * @param {NodeJS.ProcessEnv} [env]
 */
export function loadProxmoxConfigFromRepo(publicRoot = repoRoot(), env = process.env) {
  const resolved = resolveProxmoxConfigFile(publicRoot, env);
  if (!resolved.found) {
    throw missingRepoFileError(resolved, {
      exampleRel: "packages/infrastructure/proxmox/config.example.json",
    });
  }
  return {
    data: assertJsonObject(readResolvedRepoJson(resolved)),
    path: resolved.path,
    resolved,
  };
}

export function loadProxmoxMaintainConfig(packageRoot, warn, skipLabel, opts = {}) {
  try {
    return loadProxmoxPackageConfig(packageRoot);
  } catch (e) {
    const msg = /** @type {Error} */ (e).message;
    warn(`${skipLabel}: ${msg.includes("Missing") ? "missing config — skip." : msg}`);
    return null;
  }
}
