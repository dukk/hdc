import { randomBytes } from "node:crypto";
import { findInventorySidecars } from "../inventory.mjs";
import { CliExit } from "./cli-exit.mjs";
import { createVaultAccess, vaultDepsFromCli } from "./vault-access.mjs";

const TAG_PROXMOX = "proxmox";
const TAG_UBUNTU = "ubuntu";

/**
 * Vault entry for the local `hdc` user password, keyed by inventory `id`.
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
  return s.has(TAG_PROXMOX) || s.has(TAG_UBUNTU);
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
 * @param {string} passwordB64
 */
export function remoteBootstrapHdcBash(passwordB64) {
  return [
    "set -euo pipefail",
    `PW=$(printf '%s' '${passwordB64}' | base64 -d)`,
    "if ! id -u hdc >/dev/null 2>&1; then useradd -m -s /bin/bash hdc; fi",
    "if getent group sudo >/dev/null 2>&1; then usermod -aG sudo hdc 2>/dev/null || true; fi",
    "if getent group wheel >/dev/null 2>&1; then usermod -aG wheel hdc 2>/dev/null || true; fi",
    `printf '%s\\n' "hdc:$PW" | chpasswd`,
  ].join("; ");
}

export function generateHdcPassword() {
  return randomBytes(24).toString("base64url");
}

/**
 * @param {string[]} argv flags after `bootstrap-hdc`
 * @param {import("./cli-app.mjs").CliDeps} deps
 */
export async function runUsersBootstrapHdc(argv, deps) {
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

  /** @type {string[]} */
  let sidecarPaths;
  if (explicitSidecars.length) {
    sidecarPaths = explicitSidecars.map((p) =>
      deps.isAbsolute(p) ? p : deps.resolve(root, p),
    );
  } else {
    sidecarPaths = findInventorySidecars(root).filter((p) => {
      try {
        const data = JSON.parse(deps.readFileSync(p, "utf8"));
        return sidecarMatchesBootstrapTags(tagsFromSidecar(data));
      } catch {
        return false;
      }
    });
  }

  if (sidecarPaths.length === 0) {
    deps.warn(
      "users bootstrap-hdc: no matching inventory sidecars (use tags proxmox/ubuntu, or pass --sidecar).",
    );
    return;
  }

  let vaultAccess = null;
  if (!dryRun) {
    vaultAccess = createVaultAccess(vaultDepsFromCli(deps));
    await vaultAccess.unlock({});
  }

  for (const path of sidecarPaths) {
    if (!deps.existsSync(path)) {
      deps.error(`users bootstrap-hdc: sidecar not found: ${path}`);
      throw new CliExit(1);
    }
    let data;
    try {
      data = JSON.parse(deps.readFileSync(path, "utf8"));
    } catch (e) {
      deps.error(`users bootstrap-hdc: invalid JSON ${path}:`, e);
      throw new CliExit(1);
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      deps.error(`users bootstrap-hdc: invalid sidecar root: ${path}`);
      throw new CliExit(1);
    }
    const o = /** @type {Record<string, unknown>} */ (data);
    const id = typeof o.id === "string" ? o.id.trim() : "";
    if (!id) {
      deps.error(`users bootstrap-hdc: missing id in ${path}`);
      throw new CliExit(1);
    }

    const tags = tagsFromSidecar(data);
    if (explicitSidecars.length === 0 && !sidecarMatchesBootstrapTags(tags)) {
      deps.warn(`users bootstrap-hdc: skip ${path} (tags do not include proxmox/ubuntu)`);
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
