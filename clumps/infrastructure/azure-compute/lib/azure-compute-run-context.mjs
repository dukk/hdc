import { createAzureArmTokenProvider } from "./azure-compute-auth.mjs";
import { createAzureArmClient } from "./azure-arm-api.mjs";
import { normalizeAzureComputeConfig } from "./azure-compute-config.mjs";
import { resolveAzureComputeCredentials } from "./vault-deps.mjs";

export const CLUMP_CONFIG_EXAMPLE = "clumps/infrastructure/azure-compute/config.example.json";

/**
 * @param {unknown} cfgRaw
 */
export async function createAzureComputeRunContext(cfgRaw) {
  const config = normalizeAzureComputeConfig(cfgRaw);
  const creds = await resolveAzureComputeCredentials();
  const tokenProvider = createAzureArmTokenProvider({
    tenantId: creds.tenantId,
    clientId: creds.clientId,
    clientSecret: creds.clientSecret,
  });
  const client = createAzureArmClient({
    getToken: () => tokenProvider.getAccessToken(),
    subscriptionId: creds.subscriptionId,
  });
  return {
    config,
    creds: {
      ...creds,
      getToken: () => tokenProvider.getAccessToken(),
    },
    client,
    tokenProvider,
  };
}
