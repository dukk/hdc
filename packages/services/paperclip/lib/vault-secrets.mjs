import { randomBytes } from "node:crypto";
import { stderr as errout } from "node:process";

import { betterAuthSecretVaultKey, dbPasswordVaultKey } from "./paperclip-render.mjs";

/** @param {unknown} v */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * @param {ReturnType<import("./paperclip-vault-deps.mjs").createPaperclipVaultAccess>} vault
 * @param {string} key
 * @param {string} label
 */
async function loadOrGenerateSecret(vault, key, label) {
  await vault.unlock({});
  const data = await vault.readSecrets({});
  const existing = data && typeof data[key] === "string" ? data[key].trim() : "";
  if (existing) {
    errout.write(`[hdc] paperclip: ${label} loaded from vault ${key}\n`);
    return existing;
  }
  const generated = randomBytes(32).toString("base64url");
  await vault.setSecret(key, generated);
  errout.write(`[hdc] paperclip: generated ${label} and saved to vault ${key}\n`);
  return generated;
}

/**
 * @param {ReturnType<import("./paperclip-vault-deps.mjs").createPaperclipVaultAccess>} vault
 * @param {Record<string, unknown>} paperclip
 */
export async function resolvePaperclipSecrets(vault, paperclip) {
  const cfg = isObject(paperclip) ? paperclip : {};
  const authKey = betterAuthSecretVaultKey(cfg);
  const dbKey = dbPasswordVaultKey(cfg);

  const betterAuthSecret = await loadOrGenerateSecret(vault, authKey, "BETTER_AUTH_SECRET");
  const dbPassword = await loadOrGenerateSecret(vault, dbKey, "DB password");

  return { betterAuthSecret, dbPassword, authKey, dbKey };
}
