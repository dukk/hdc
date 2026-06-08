import { randomBytes } from "node:crypto";
import { stderr as errout } from "node:process";

import {
  dashboardAuthSecretVaultKey,
  dashboardPasswordVaultKey,
  openrouterVaultKey,
} from "./deployments.mjs";

/** @param {unknown} v */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * @param {ReturnType<import("./vault-deps.mjs").createHermesVaultAccess>} vault
 * @param {string} key
 * @param {{ generate?: boolean; label?: string }} [opts]
 */
async function loadSecret(vault, key, opts = {}) {
  await vault.unlock({});
  const data = await vault.readSecrets({});
  const existing = data && typeof data[key] === "string" ? data[key].trim() : "";
  if (existing) {
    errout.write(`[hdc] hermes: secret loaded from vault ${key}\n`);
    return existing;
  }
  if (opts.generate) {
    const generated = randomBytes(32).toString("hex");
    await vault.setSecret(key, generated);
    errout.write(`[hdc] hermes: generated secret and saved to vault ${key}\n`);
    return generated;
  }
  throw new Error(
    `missing vault secret ${key}${opts.label ? ` (${opts.label})` : ""} — run: node tools/hdc/cli.mjs secrets set ${key}`,
  );
}

/**
 * @param {ReturnType<import("./vault-deps.mjs").createHermesVaultAccess>} vault
 * @param {Record<string, unknown>} hermes
 */
export async function resolveHermesSecrets(vault, hermes) {
  const cfg = isObject(hermes) ? hermes : {};
  const openrouterKey = openrouterVaultKey(cfg);
  const dashboardPasswordKey = dashboardPasswordVaultKey(cfg);
  const dashboardAuthSecretKey = dashboardAuthSecretVaultKey(cfg);

  const openrouterApiKey = await loadSecret(vault, openrouterKey, {
    label: "OpenRouter API key",
  });
  const dashboardPassword = await loadSecret(vault, dashboardPasswordKey, {
    label: "dashboard basic auth password",
  });
  const dashboardAuthSecret = await loadSecret(vault, dashboardAuthSecretKey, {
    generate: true,
  });

  /** @type {Record<string, string>} */
  const extraEnv = {};
  const envExtra = isObject(cfg.env_extra) ? cfg.env_extra : {};
  for (const [envName, vaultKeyRaw] of Object.entries(envExtra)) {
    const envVar = typeof envName === "string" ? envName.trim() : "";
    const vaultKey = typeof vaultKeyRaw === "string" ? vaultKeyRaw.trim() : "";
    if (!envVar || !vaultKey) continue;
    extraEnv[envVar] = await loadSecret(vault, vaultKey, { label: envVar });
  }

  return {
    openrouterApiKey,
    dashboardPassword,
    dashboardAuthSecret,
    extraEnv,
    vaultKeys: {
      openrouter: openrouterKey,
      dashboardPassword: dashboardPasswordKey,
      dashboardAuthSecret: dashboardAuthSecretKey,
    },
  };
}
