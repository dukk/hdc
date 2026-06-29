import { randomBytes } from "node:crypto";
import { stderr as errout } from "node:process";

import {
  anthropicApiKeyVaultKey,
  betterAuthSecretVaultKey,
  cursorApiKeyVaultKey,
  dbPasswordVaultKey,
  googleGeminiApiKeyVaultKey,
  openaiApiKeyVaultKey,
} from "./paperclip-render.mjs";

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
  const existing = String(
    await vault.getSecret(key, { optional: true, promptLabel: `vault secret ${key}` }),
  ).trim();
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
 * @param {string} key
 * @param {string} label
 */
async function loadOptionalSecret(vault, key, label) {
  await vault.unlock({});
  const existing = String(
    await vault.getSecret(key, { optional: true, promptLabel: `vault secret ${key}` }),
  ).trim();
  if (existing) {
    errout.write(`[hdc] paperclip: ${label} loaded from vault ${key}\n`);
  }
  return existing;
}

/**
 * @param {ReturnType<import("./paperclip-vault-deps.mjs").createPaperclipVaultAccess>} vault
 * @param {Record<string, unknown>} paperclip
 */
export async function resolvePaperclipSecrets(vault, paperclip) {
  const cfg = isObject(paperclip) ? paperclip : {};
  const authKey = betterAuthSecretVaultKey(cfg);
  const dbKey = dbPasswordVaultKey(cfg);
  const cursorKey = cursorApiKeyVaultKey(cfg);
  const anthropicKey = anthropicApiKeyVaultKey(cfg);
  const openaiKey = openaiApiKeyVaultKey(cfg);
  const googleGeminiKey = googleGeminiApiKeyVaultKey(cfg);

  const betterAuthSecret = await loadOrGenerateSecret(vault, authKey, "BETTER_AUTH_SECRET");
  const dbPassword = await loadOrGenerateSecret(vault, dbKey, "DB password");
  const cursorApiKey = await loadOptionalSecret(vault, cursorKey, "CURSOR_API_KEY");
  const anthropicApiKey = await loadOptionalSecret(vault, anthropicKey, "ANTHROPIC_API_KEY");
  const openaiApiKey = await loadOptionalSecret(vault, openaiKey, "OPENAI_API_KEY");
  const googleGeminiApiKey = await loadOptionalSecret(vault, googleGeminiKey, "GOOGLE_API_KEY");

  return {
    betterAuthSecret,
    dbPassword,
    cursorApiKey,
    anthropicApiKey,
    openaiApiKey,
    googleGeminiApiKey,
    authKey,
    dbKey,
    cursorKey,
    anthropicKey,
    openaiKey,
    googleGeminiKey,
  };
}
