#!/usr/bin/env node
/**
 * Sync homepage Proxmox service-account secrets from local vault into Vaultwarden.
 * Fixes empty Vaultwarden login items that break readSecrets() during maintain.
 */
import { createPackageVaultAccess } from "../../../packages/lib/package-vault-access.mjs";
import { stderr as errout } from "node:process";

const KEYS = ["HDC_HOMEPAGE_PROXMOX_API_TOKEN", "HDC_PROXMOX_USER_HOMEPAGE_PASSWORD"];

const vault = createPackageVaultAccess();
const local = await vault.readLocalSecrets({ createIfMissing: false });
if (local === null) {
  errout.write("[hdc] fix-homepage-pve-vaultwarden: no local vault\n");
  process.exit(1);
}

/** @type {string[]} */
const synced = [];
/** @type {string[]} */
const missing = [];

for (const key of KEYS) {
  const value = typeof local[key] === "string" ? local[key].trim() : "";
  if (!value) {
    missing.push(key);
    continue;
  }
  await vault.setSecret(key, value);
  synced.push(key);
}

for (const key of synced) {
  errout.write(`[hdc] fix-homepage-pve-vaultwarden: synced ${key} to Vaultwarden\n`);
}
for (const key of missing) {
  errout.write(`[hdc] fix-homepage-pve-vaultwarden: WARN local vault missing ${key}\n`);
}

process.exit(missing.length > 0 ? 1 : 0);
