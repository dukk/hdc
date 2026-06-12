import { randomBytes } from "node:crypto";
import { stderr as errout } from "node:process";

import { dbPasswordVaultKey, encryptionKeyVaultKey, generateTwentyDbPassword } from "./twenty-render.mjs";

/** @param {unknown} v */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * @param {ReturnType<import("./twenty-vault-deps.mjs").createTwentyVaultAccess>} vault
 * @param {string} key
 * @param {string} label
 * @param {() => string} generate
 */
async function loadOrGenerateSecret(vault, key, label, generate) {
  await vault.unlock({});
  const data = await vault.readSecrets({});
  const existing = data && typeof data[key] === "string" ? data[key].trim() : "";
  if (existing) {
    errout.write(`[hdc] twenty: ${label} loaded from vault ${key}\n`);
    return existing;
  }
  const generated = generate();
  await vault.setSecret(key, generated);
  errout.write(`[hdc] twenty: generated ${label} and saved to vault ${key}\n`);
  return generated;
}

/**
 * @param {ReturnType<import("./twenty-vault-deps.mjs").createTwentyVaultAccess>} vault
 * @param {Record<string, unknown>} twenty
 */
export async function resolveTwentySecrets(vault, twenty) {
  const cfg = isObject(twenty) ? twenty : {};
  const encryptionKeyName = encryptionKeyVaultKey(cfg);
  const dbKey = dbPasswordVaultKey(cfg);

  const encryptionKey = await loadOrGenerateSecret(
    vault,
    encryptionKeyName,
    "encryption key",
    () => randomBytes(32).toString("base64"),
  );
  const dbPassword = await loadOrGenerateSecret(
    vault,
    dbKey,
    "DB password",
    generateTwentyDbPassword,
  );

  return { encryptionKey, dbPassword, encryptionKeyName, dbKey };
}
