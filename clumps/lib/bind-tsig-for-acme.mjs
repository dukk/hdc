import { join } from "node:path";

import { loadClumpConfigFromClumpRoot } from "./clump-run-config.mjs";

/**
 * @param {string} secret
 */
export function bindTsigSecretLooksValid(secret) {
  const s = String(secret || "").trim();
  if (s.length < 40) return false;
  try {
    return Buffer.from(s, "base64").length >= 16;
  } catch {
    return false;
  }
}

/**
 * Authoritative BIND TSIG from bind clump config (hdc-private when present).
 * @param {string} repoRoot
 */
export function loadBindTsigSecretFromConfig(repoRoot) {
  const bindRoot = join(repoRoot, "packages", "services", "bind");
  const { data } = loadClumpConfigFromClumpRoot(bindRoot, {
    exampleRel: "clumps/services/bind/config.example.json",
  });
  const bind = data && typeof data === "object" ? /** @type {Record<string, unknown>} */ (data).bind : null;
  const raw =
    bind && typeof bind === "object" && !Array.isArray(bind)
      ? /** @type {Record<string, unknown>} */ (bind).tsig_secret
      : "";
  return typeof raw === "string" ? raw.trim() : "";
}

/**
 * Vault TSIG for certbot dns-01, falling back to bind.config bind.tsig_secret when vault value is invalid.
 * @param {Awaited<ReturnType<typeof import("./package-vault-access.mjs").createPackageVaultAccess>>} vault
 * @param {string} vaultKey
 * @param {string} repoRoot
 */
export async function resolveBindTsigForAcme(vault, vaultKey, repoRoot) {
  let tsig = String(
    await vault.getSecret(vaultKey, {
      promptLabel: `vault secret ${vaultKey}`,
    }),
  ).trim();
  if (!bindTsigSecretLooksValid(tsig)) {
    const fromConfig = loadBindTsigSecretFromConfig(repoRoot);
    if (bindTsigSecretLooksValid(fromConfig)) {
      tsig = fromConfig;
    }
  }
  return tsig;
}
