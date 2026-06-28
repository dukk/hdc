import { randomBytes } from "node:crypto";
import { stderr as errout } from "node:process";

import { dbPasswordVaultKey } from "./affine-render.mjs";

/** @param {unknown} v */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * @param {ReturnType<import("./affine-vault-deps.mjs").createAffineVaultAccess>} vault
 * @param {string} key
 * @param {string} label
 */
async function loadOrGenerateSecret(vault, key, label) {
  await vault.unlock({});
  const data = await vault.readSecrets({});
  const existing = data && typeof data[key] === "string" ? data[key].trim() : "";
  if (existing) {
    errout.write(`[hdc] affine: ${label} loaded from vault ${key}\n`);
    return existing;
  }
  const generated = randomBytes(32).toString("base64url");
  await vault.setSecret(key, generated);
  errout.write(`[hdc] affine: generated ${label} and saved to vault ${key}\n`);
  return generated;
}

/**
 * @param {ReturnType<import("./affine-vault-deps.mjs").createAffineVaultAccess>} vault
 * @param {Record<string, unknown>} affine
 */
export async function resolveAffineSecrets(vault, affine) {
  const cfg = isObject(affine) ? affine : {};
  const dbKey = dbPasswordVaultKey(cfg);
  const dbPassword = await loadOrGenerateSecret(vault, dbKey, "DB password");
  return { dbPassword, dbKey };
}
