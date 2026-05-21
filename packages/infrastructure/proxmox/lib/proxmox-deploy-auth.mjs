import { createInterface } from "node:readline/promises";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { stdin as input, stderr as errout, env } from "node:process";
import { createVaultAccess, vaultDepsFromCli } from "../../../../tools/hdc/lib/vault-access.mjs";
import { readLineMasked } from "../../../../tools/hdc/lib/readline-masked.mjs";
import { defaultVaultPath } from "../../../../tools/hdc/vault.mjs";
import {
  HDC_TLS_INSECURE_ENV,
  hdcTlsInsecureSourceEnv,
  hdcTlsRejectUnauthorized,
} from "../../../../tools/hdc/lib/tls-insecure-env.mjs";
import { pveJsonRequest } from "./pve-http.mjs";
import { apiBaseFromWebUi, resolveProxmoxHost } from "./proxmox-config.mjs";

export { apiBaseFromWebUi, resolveProxmoxHost } from "./proxmox-config.mjs";

const VAULT_KEY_GLOBAL = "HDC_PROXMOX_API_TOKEN";
const SPEC_TLS_INSECURE = "HDC_PROXMOX_TLS_INSECURE";

/**
 * @param {string} hostInventoryId e.g. pve-a
 */
export function vaultTokenKeyForHost(hostInventoryId) {
  return `HDC_PROXMOX_API_TOKEN_${hostInventoryId.toUpperCase().replace(/-/g, "_")}`;
}

/**
 * @param {string} raw
 */
export function normalizePveAuthorization(raw) {
  const t = raw.trim();
  if (!t) return t;
  if (/^PVEAPIToken=/i.test(t)) return t;
  return `PVEAPIToken=${t}`;
}

/**
 * @param {string} baseUrl
 * @param {string} authorization
 * @param {boolean} rejectUnauthorized
 * @param {string[]} [verifyPaths] Extra GET paths the token must succeed on (after /version).
 */
async function verifyToken(baseUrl, authorization, rejectUnauthorized, verifyPaths = []) {
  await pveJsonRequest("GET", baseUrl, "/version", authorization, rejectUnauthorized, undefined);
  for (const path of verifyPaths) {
    await pveJsonRequest("GET", baseUrl, path, authorization, rejectUnauthorized, undefined);
  }
}

/** Paths used by maintain to ensure the token can list cluster VMs, not only /version. */
export const PROXMOX_MAINTAIN_VERIFY_PATHS = ["/cluster/resources?type=vm"];

/**
 * @param {{ packageRoot: string; hostId: string; vault?: ReturnType<typeof createVaultAccess>; verifyPaths?: string[] }} opts
 */
export async function authorizeProxmoxForHost(opts) {
  const { packageRoot, hostId, vault: vaultIn, verifyPaths = [] } = opts;
  const rejectUnauthorized = hdcTlsRejectUnauthorized(env, SPEC_TLS_INSECURE);
  const tlsNote = hdcTlsInsecureSourceEnv(env, SPEC_TLS_INSECURE);

  const configPath = join(packageRoot, "config.json");
  if (!existsSync(configPath)) {
    throw new Error(`Missing config: copy packages/infrastructure/proxmox/config.example.json to config.json`);
  }
  /** @type {unknown} */
  let cfg;
  cfg = JSON.parse(readFileSync(configPath, "utf8"));
  const host = resolveProxmoxHost(cfg, hostId);
  if (!host) {
    throw new Error(
      `Unknown Proxmox host id ${JSON.stringify(hostId)} in infrastructure/proxmox/config.json (need clusters[].hosts[] with web_ui)`,
    );
  }

  const vault =
    vaultIn ??
    createVaultAccess(
      vaultDepsFromCli({
        env,
        log: (...a) => errout.write(`${a.join(" ")}\n`),
        error: (...a) => errout.write(`${a.join(" ")}\n`),
        warn: (...a) => errout.write(`${a.join(" ")}\n`),
        defaultVaultPath,
        existsSync,
        readLineQuestion: async (q, qopts) => {
          if (qopts?.mask) {
            return readLineMasked(q, errout, input);
          }
          const rl = createInterface({ input, output: errout });
          try {
            return await rl.question(q);
          } finally {
            rl.close();
          }
        },
      }),
    );

  /** @type {string | null} */
  let authorization = null;

  const envTok = String(env.HDC_PROXMOX_API_TOKEN ?? "").trim();
  if (envTok) {
    const auth = normalizePveAuthorization(envTok);
    try {
      await verifyToken(host.apiBase, auth, rejectUnauthorized, verifyPaths);
      authorization = auth;
    } catch {
      /* try vault */
    }
  }

  if (!authorization) {
    const data = (await vault.readSecrets({})) ?? {};
    const perKey = vaultTokenKeyForHost(host.id);
    const perVal = typeof data[perKey] === "string" ? data[perKey].trim() : "";
    const globVal = typeof data[VAULT_KEY_GLOBAL] === "string" ? data[VAULT_KEY_GLOBAL].trim() : "";
    if (perVal) {
      const auth = normalizePveAuthorization(perVal);
      try {
        await verifyToken(host.apiBase, auth, rejectUnauthorized, verifyPaths);
        authorization = auth;
      } catch {
        /* continue */
      }
    }
    if (!authorization && globVal) {
      const auth = normalizePveAuthorization(globVal);
      try {
        await verifyToken(host.apiBase, auth, rejectUnauthorized, verifyPaths);
        authorization = auth;
      } catch {
        /* continue */
      }
    }
  }

  if (!authorization) {
    const data = (await vault.readSecrets({})) ?? {};
    const perKey = vaultTokenKeyForHost(host.id);
    const hasPerHost = typeof data[perKey] === "string" && data[perKey].trim();
    const token = await vault.getSecret(hasPerHost ? perKey : VAULT_KEY_GLOBAL, {
      promptLabel: hasPerHost
        ? `Proxmox API token for ${host.id} (user@realm!tokenid=secret, or PVEAPIToken=…)`
        : "Proxmox API token (user@realm!tokenid=secret, or prefix with PVEAPIToken=)",
      verify: async (v) => {
        await verifyToken(host.apiBase, normalizePveAuthorization(v), rejectUnauthorized, verifyPaths);
        return true;
      },
    });
    authorization = normalizePveAuthorization(token);
  }

  return {
    host: {
      id: host.id,
      pveNode: host.pveNode,
      apiBase: host.apiBase,
      rel: "",
    },
    authorization,
    rejectUnauthorized,
    tlsInsecureLabel: tlsNote,
    hdcTlsInsecureEnv: HDC_TLS_INSECURE_ENV,
    specTlsInsecure: SPEC_TLS_INSECURE,
  };
}

/** Paths used by storage maintain (list/create storage). */
export const PROXMOX_STORAGE_VERIFY_PATHS = ["/storage"];

/**
 * Try each cluster member until API auth succeeds.
 * @param {object} opts
 * @param {string} opts.packageRoot
 * @param {{ id: string }[]} opts.members
 * @param {ReturnType<typeof createVaultAccess>} [opts.vault]
 * @param {(line: string) => void} opts.warn
 * @param {string[]} [opts.verifyPaths]
 */
export async function authorizeProxmoxForClusterMembers(opts) {
  const { packageRoot, members, vault, warn, verifyPaths = PROXMOX_MAINTAIN_VERIFY_PATHS } = opts;
  for (const m of members) {
    try {
      return await authorizeProxmoxForHost({
        packageRoot,
        hostId: m.id,
        vault,
        verifyPaths,
      });
    } catch (e) {
      warn(`API auth via ${JSON.stringify(m.id)} failed: ${/** @type {Error} */ (e).message || e}`);
    }
  }
  return null;
}
