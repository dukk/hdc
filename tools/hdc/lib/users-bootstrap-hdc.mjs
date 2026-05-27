import { randomBytes } from "node:crypto";
import { CliExit } from "./cli-exit.mjs";
import { createVaultAccess, vaultDepsFromCli } from "./vault-access.mjs";
import { readResolvedPackageConfigJson } from "./json-config-preprocess.mjs";
import { resolveRepoFile, resolveRepoFilePath } from "./private-repo.mjs";

import { remoteBootstrapHdcBash } from "../../../packages/lib/linux-local-admin-user.mjs";

export { remoteBootstrapHdcBash };

const TAG_PROXMOX = "proxmox";
const TAG_UBUNTU = "ubuntu";
const TAG_CLIENT = "client";

/**
 * Vault entry for the local `hdc` user password, keyed by host `id` (from sidecar or package config).
 * Example: `my-cluster` → `HDC_USER_HDC_PASSWORD_MY_CLUSTER`
 * @param {string} inventoryId
 * @returns {string}
 */
export function vaultKeyForHdcLocalPassword(inventoryId) {
  const suffix = inventoryIdToVaultSuffix(inventoryId);
  return `HDC_USER_HDC_PASSWORD_${suffix}`;
}

/**
 * @param {string} inventoryId
 */
export function inventoryIdToVaultSuffix(inventoryId) {
  return inventoryId
    .trim()
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

/**
 * @param {unknown} v
 * @returns {string[]}
 */
export function tagsFromSidecar(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return [];
  const t = /** @type {Record<string, unknown>} */ (v).tags;
  if (!Array.isArray(t)) return [];
  return t.map(String);
}

/**
 * @param {string[]} tags
 */
export function sidecarMatchesBootstrapTags(tags) {
  const s = new Set(tags.map((x) => x.toLowerCase()));
  return s.has(TAG_PROXMOX) || s.has(TAG_UBUNTU) || s.has(TAG_CLIENT);
}

/**
 * @param {string | undefined} ssh
 * @returns {{ user: string | null, host: string } | null}
 */
export function parseSshUrl(ssh) {
  if (!ssh || typeof ssh !== "string" || !ssh.trim()) return null;
  const u = ssh.trim();
  try {
    const parsed = new URL(u);
    if (parsed.protocol !== "ssh:") return null;
    const host = parsed.hostname;
    if (!host) return null;
    const user = parsed.username ? decodeURIComponent(parsed.username) : null;
    return { user, host };
  } catch {
    return null;
  }
}

/**
 * @param {unknown} auth
 * @param {NodeJS.ProcessEnv} env
 * @returns {string | null}
 */
export function sshUserFromAuthEnv(auth, env) {
  if (!auth || typeof auth !== "object" || Array.isArray(auth)) return null;
  const key = /** @type {Record<string, unknown>} */ (auth).ssh_user_env;
  if (typeof key !== "string" || !key.trim()) return null;
  const v = env[key.trim()];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * @param {unknown} node
 * @param {unknown} auth
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ host: string, user: string } | null}
 */
export function resolveSshTargetForNode(node, auth, env) {
  if (!node || typeof node !== "object" || Array.isArray(node)) return null;
  const o = /** @type {Record<string, unknown>} */ (node);
  const parsed = parseSshUrl(typeof o.ssh === "string" ? o.ssh : "");
  if (!parsed) return null;
  const fromUrl = parsed.user;
  const fromAuth = sshUserFromAuthEnv(auth, env);
  const user = fromUrl ?? fromAuth;
  if (!user) return null;
  return { host: parsed.host, user };
}

/**
 * @param {unknown} sidecar
 * @returns {{ host: string, user: string }[]}
 */
export function listSshTargetsFromSidecar(sidecar, env) {
  if (!sidecar || typeof sidecar !== "object" || Array.isArray(sidecar)) return [];
  const o = /** @type {Record<string, unknown>} */ (sidecar);
  const access = o.access;
  if (!access || typeof access !== "object" || Array.isArray(access)) return [];
  const nodes = /** @type {Record<string, unknown>} */ (access).nodes;
  if (!Array.isArray(nodes)) return [];
  const auth = o.auth;
  /** @type {{ host: string, user: string }[]} */
  const out = [];
  for (const n of nodes) {
    const t = resolveSshTargetForNode(n, auth, env);
    if (t) out.push(t);
  }
  return out;
}

/**
 * Host entries from `bootstrap_hosts` in infrastructure package config.json files
 * (tags must include "proxmox" or "ubuntu", case-insensitive).
 * @param {string} root
 * @param {import("./cli-app.mjs").CliDeps} deps
 * @returns {{ label: string, data: Record<string, unknown> }[]}
 */
export function bootstrapHostDocsFromInfrastructureConfigs(root, deps) {
  /** @type {{ label: string, data: Record<string, unknown> }[]} */
  const out = [];
  /** @type {{ tier: string, pkg: string }[]} */
  const sources = [
    { tier: "infrastructure", pkg: "ubuntu" },
    { tier: "infrastructure", pkg: "proxmox" },
  ];
  const clientResolved = resolveRepoFile(root, "packages/clients/config.json");
  if (clientResolved.found) {
    /** @type {unknown} */
    let j;
    try {
      j = readResolvedPackageConfigJson(clientResolved, { publicRoot: root });
    } catch {
      j = null;
    }
    if (j && typeof j === "object" && !Array.isArray(j)) {
      const hosts = /** @type {Record<string, unknown>} */ (j).bootstrap_hosts;
      if (Array.isArray(hosts)) {
        let idx = 0;
        for (const h of hosts) {
          idx += 1;
          if (!h || typeof h !== "object" || Array.isArray(h)) continue;
          const rec = /** @type {Record<string, unknown>} */ (h);
          if (!sidecarMatchesBootstrapTags(tagsFromSidecar(rec))) continue;
          const id = typeof rec.id === "string" ? rec.id.trim() : "";
          const src =
            clientResolved.source === "private"
              ? `packages/clients/config.json (hdc-private)`
              : "packages/clients/config.json";
          out.push({
            label: `${src}#${id || `bootstrap_hosts[${idx}]`}`,
            data: rec,
          });
        }
      }
    }
  }

  for (const { tier, pkg } of sources) {
    const rel = `packages/${tier}/${pkg}/config.json`;
    const resolved = resolveRepoFile(root, rel);
    if (!resolved.found) continue;
    /** @type {unknown} */
    let j;
    try {
      j = readResolvedPackageConfigJson(resolved, { publicRoot: root });
    } catch {
      continue;
    }
    if (!j || typeof j !== "object" || Array.isArray(j)) continue;
    const hosts = /** @type {Record<string, unknown>} */ (j).bootstrap_hosts;
    if (!Array.isArray(hosts)) continue;
    let idx = 0;
    for (const h of hosts) {
      idx += 1;
      if (!h || typeof h !== "object" || Array.isArray(h)) continue;
      const rec = /** @type {Record<string, unknown>} */ (h);
      if (!sidecarMatchesBootstrapTags(tagsFromSidecar(rec))) continue;
      const id = typeof rec.id === "string" ? rec.id.trim() : "";
      const src =
        resolved.source === "private"
          ? `packages/${tier}/${pkg}/config.json (hdc-private)`
          : `packages/${tier}/${pkg}/config.json`;
      out.push({
        label: `${src}#${id || `bootstrap_hosts[${idx}]`}`,
        data: rec,
      });
    }
  }
  return out;
}

export function generateHdcPassword() {
  return randomBytes(24).toString("base64url");
}

/**
 * @param {string[]} argv flags after `bootstrap-hdc`
 * @param {import("./cli-app.mjs").CliDeps} deps
 * @param {{ vault?: ReturnType<typeof createVaultAccess> }} [options]
 */
export async function runUsersBootstrapHdc(argv, deps, options = {}) {
  const dryRun = argv.includes("--dry-run");
  /** @type {string[]} */
  const explicitSidecars = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--sidecar") {
      const p = argv[++i];
      if (p) explicitSidecars.push(p);
    }
  }

  const root = deps.repoRoot();

  /** @type {{ label: string; path?: string; data?: Record<string, unknown> }[]} */
  const work = [];
  if (explicitSidecars.length) {
    for (const p of explicitSidecars) {
      const resolved = resolveRepoFilePath(root, p);
      const path = resolved.found ? resolved.path : deps.isAbsolute(p) ? p : deps.resolve(root, p);
      work.push({ label: path, path });
    }
  } else {
    for (const { label, data } of bootstrapHostDocsFromInfrastructureConfigs(root, deps)) {
      work.push({ label, data });
    }
  }

  if (work.length === 0) {
    deps.warn(
      "users bootstrap-hdc: no bootstrap_hosts in packages/infrastructure/{ubuntu,proxmox} or packages/clients/config.json (or pass --sidecar).",
    );
    return;
  }

  let vaultAccess = options.vault ?? null;
  if (!dryRun) {
    if (!vaultAccess) {
      vaultAccess = createVaultAccess(vaultDepsFromCli(deps));
    }
    await vaultAccess.unlock({});
  }

  for (const item of work) {
    /** @type {Record<string, unknown>} */
    let data;
    const label = item.label;
    if (item.path) {
      if (!deps.existsSync(item.path)) {
        deps.error(`users bootstrap-hdc: sidecar not found: ${item.path}`);
        throw new CliExit(1);
      }
      try {
        data = JSON.parse(deps.readFileSync(item.path, "utf8"));
      } catch (e) {
        deps.error(`users bootstrap-hdc: invalid JSON ${item.path}:`, e);
        throw new CliExit(1);
      }
    } else if (item.data) {
      data = item.data;
    } else {
      deps.error("users bootstrap-hdc: internal error (empty work item)");
      throw new CliExit(1);
    }

    if (!data || typeof data !== "object" || Array.isArray(data)) {
      deps.error(`users bootstrap-hdc: invalid sidecar root: ${label}`);
      throw new CliExit(1);
    }
    const o = /** @type {Record<string, unknown>} */ (data);
    const id = typeof o.id === "string" ? o.id.trim() : "";
    if (!id) {
      deps.error(`users bootstrap-hdc: missing id in ${label}`);
      throw new CliExit(1);
    }

    const tags = tagsFromSidecar(data);
    if (explicitSidecars.length === 0 && item.path && !sidecarMatchesBootstrapTags(tags)) {
      deps.warn(`users bootstrap-hdc: skip ${label} (tags do not include proxmox/ubuntu)`);
      continue;
    }

    const targets = listSshTargetsFromSidecar(data, deps.env);
    if (targets.length === 0) {
      deps.warn(`users bootstrap-hdc: skip ${id} (no access.nodes[].ssh targets)`);
      continue;
    }

    const vaultKey = vaultKeyForHdcLocalPassword(id);
    const password = generateHdcPassword();
    const pwB64 = Buffer.from(password, "utf8").toString("base64");
    const remote = remoteBootstrapHdcBash(pwB64);

    deps.log(`[${id}] vault key ${vaultKey} (${targets.length} host(s))`);

    if (dryRun) {
      for (const t of targets) {
        deps.log(`  dry-run: would ssh ${t.user}@${t.host}`);
      }
      continue;
    }

    if (!vaultAccess) {
      deps.error("users bootstrap-hdc: internal error (vault not initialized)");
      throw new CliExit(1);
    }
    await vaultAccess.setSecret(vaultKey, password);

    for (const t of targets) {
      const args = [
        "-o",
        "BatchMode=yes",
        "-o",
        "StrictHostKeyChecking=accept-new",
        `${t.user}@${t.host}`,
        "bash",
        "-lc",
        remote,
      ];
      deps.log(`  ssh ${t.user}@${t.host}`);
      const r = deps.spawnSync("ssh", args, {
        stdio: ["ignore", "inherit", "inherit"],
        env: deps.env,
        shell: false,
      });
      if (r.status !== 0) {
        deps.error(`users bootstrap-hdc: ssh failed for ${t.user}@${t.host} (status ${r.status ?? "?"})`);
        throw new CliExit(1);
      }
    }
  }
}
