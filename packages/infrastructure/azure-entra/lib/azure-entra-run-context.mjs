import { createAzureGraphTokenProvider } from "./azure-graph-auth.mjs";
import { createAzureGraphClient } from "./azure-graph-api.mjs";
import { normalizeAzureEntraConfig } from "./azure-entra-config.mjs";
import {
  createAzureEntraVaultAccess,
  resolveAzureClientId,
  resolveAzureClientSecret,
  resolveAzureTenantId,
} from "./vault-deps.mjs";

export const PACKAGE_CONFIG_EXAMPLE = "packages/infrastructure/azure-entra/config.example.json";

/**
 * @param {unknown} cfgRaw
 */
export async function createAzureEntraRunContext(cfgRaw) {
  const config = normalizeAzureEntraConfig(cfgRaw);
  const vault = createAzureEntraVaultAccess();
  const tenantId = resolveAzureTenantId();
  const clientId = resolveAzureClientId();
  const clientSecret = await resolveAzureClientSecret(vault);
  const tokenProvider = createAzureGraphTokenProvider({ tenantId, clientId, clientSecret });
  const api = createAzureGraphClient({
    baseUrl: config.graphBase,
    getAccessToken: () => tokenProvider.getAccessToken(),
  });
  return { config, api, tenantId };
}

/**
 * @param {import('./azure-entra-config.mjs').ConfigApplication} cfgApp
 * @param {import('./azure-graph-api.mjs').GraphApplication[]} allLive
 * @returns {import('./azure-graph-api.mjs').GraphApplication | null}
 */
export function findLiveGraphAppForConfig(cfgApp, allLive) {
  if (cfgApp.match.client_id) {
    const byClient = allLive.find((a) => a.appId === cfgApp.match.client_id);
    if (byClient) return byClient;
  }
  const name = (cfgApp.match.display_name ?? cfgApp.display_name).trim().toLowerCase();
  if (!name) return null;
  return (
    allLive.find((a) => a.displayName.trim().toLowerCase() === name) ??
    null
  );
}
