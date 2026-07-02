import { randomBytes } from "node:crypto";
import { stderr as errout } from "node:process";

import { uiPasswordVaultKey, uiSessionSecretVaultKey, uiApiTokenVaultKey } from "./hdc-runner-settings.mjs";

/**
 * @param {ReturnType<typeof import("./vault-deps.mjs").createHdcRunnerVaultAccess>} vault
 * @param {string} key
 * @param {{ generate?: boolean; label?: string }} [opts]
 */
async function loadSecret(vault, key, opts = {}) {
  await vault.unlock({});
  const existing = String(await vault.getSecret(key, { optional: true, promptLabel: opts.label })).trim();
  if (existing) {
    errout.write(`[hdc] hdc-runner: secret loaded ${key}\n`);
    return existing;
  }
  if (opts.generate) {
    const generated = randomBytes(32).toString("hex");
    await vault.setSecret(key, generated);
    errout.write(`[hdc] hdc-runner: generated secret and saved to vault ${key}\n`);
    return generated;
  }
  throw new Error(
    `missing vault secret ${key}${opts.label ? ` (${opts.label})` : ""} — run: node tools/hdc/cli.mjs secrets set ${key}`,
  );
}

/**
 * Resolve UI auth secrets for guest .env push.
 *
 * @param {ReturnType<typeof import("./vault-deps.mjs").createHdcRunnerVaultAccess>} vault
 * @param {ReturnType<typeof import("./hdc-runner-settings.mjs").normalizeHdcRunnerWebBlock>} web
 */
export async function resolveHdcRunnerUiSecrets(vault, web) {
  if (!web.enabled) {
    return { uiPassword: null, sessionSecret: null, apiToken: null, vaultKeys: {} };
  }

  const passwordKey = uiPasswordVaultKey(web);
  const sessionKey = uiSessionSecretVaultKey(web);
  const apiTokenKey = uiApiTokenVaultKey(web);

  const uiPassword = await loadSecret(vault, passwordKey, {
    label: "hdc-runner web UI password",
    generate: true,
  });
  const sessionSecret = await loadSecret(vault, sessionKey, {
    label: "hdc-runner web UI session secret",
    generate: true,
  });
  const apiToken = await loadSecret(vault, apiTokenKey, {
    label: "hdc-runner API token",
    generate: true,
  });

  return {
    uiPassword,
    sessionSecret,
    apiToken,
    vaultKeys: { uiPassword: passwordKey, sessionSecret: sessionKey, apiToken: apiTokenKey },
  };
}

/**
 * @param {ReturnType<typeof import("./vault-deps.mjs").createHdcRunnerVaultAccess>} vault
 * @param {ReturnType<typeof import("./hdc-runner-settings.mjs").normalizePaperclipBridgeBlock>} bridge
 */
export async function resolvePaperclipBridgeSecret(vault, bridge) {
  if (!bridge.enabled) return { bridgeSecret: null, vaultKey: null };
  const key = bridge.secret_vault_key;
  const bridgeSecret = await loadSecret(vault, key, {
    label: "paperclip agent bridge secret",
    generate: true,
  });
  return { bridgeSecret, vaultKey: key };
}

/**
 * Resolve Cursor API key for agent CLI on guest (.env push).
 *
 * @param {ReturnType<typeof import("./vault-deps.mjs").createHdcRunnerVaultAccess>} vault
 * @param {ReturnType<typeof import("./hdc-runner-settings.mjs").normalizeHdcRunnerAgentsBlock>} agents
 */
export async function resolveCursorApiKey(vault, agents) {
  if (!agents.enabled) return { apiKey: null, vaultKey: null };
  await vault.unlock({});
  const key = agents.cursor_api_key_vault_key;
  let apiKey = String(await vault.getSecret(key, { optional: true })).trim();
  if (!apiKey) {
    apiKey = String(await vault.getSecret("HDC_PAPERCLIP_CURSOR_API_KEY", { optional: true })).trim();
  }
  if (!apiKey) {
    throw new Error(
      `missing vault secret ${key} (or HDC_PAPERCLIP_CURSOR_API_KEY) — run: node tools/hdc/cli.mjs secrets set ${key}`,
    );
  }
  errout.write(`[hdc] hdc-runner: secret loaded ${key}\n`);
  return { apiKey, vaultKey: key };
}
