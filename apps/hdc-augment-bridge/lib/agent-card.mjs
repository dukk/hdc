import { formatA2aAgentDescription } from "../../hdc-cli/lib/litellm-a2a-metadata.mjs";

const A2A_VERSION = "0.3.0";

/**
 * @param {object} opts
 * @param {string} opts.name
 * @param {string} opts.hostHeader
 * @param {string} [opts.description]
 * @param {string} [opts.runtime]
 * @param {string[]} [opts.repos]
 * @param {string[]} [opts.delegatableBy]
 */
export function buildAugmentAgentCard(opts) {
  const host = opts.hostHeader.split(":")[0] || "localhost";
  const port = opts.hostHeader.includes(":") ? opts.hostHeader.split(":")[1] : "9210";
  const baseUrl = `http://${host}:${port}`;
  const description = formatA2aAgentDescription({
    name: opts.name,
    description: opts.description ?? `HDC augmentor ${opts.name}`,
    kind: "augmentor",
    runtime: opts.runtime ?? "custom",
    repos: opts.repos ?? [],
    delegatable_by: opts.delegatableBy ?? [],
  });

  return {
    name: opts.name,
    description,
    version: A2A_VERSION,
    protocolVersion: "0.3",
    url: `${baseUrl}/a2a`,
    capabilities: {
      streaming: false,
      pushNotifications: false,
    },
    skills: [
      {
        id: `${opts.name}.augment`,
        name: `${opts.name} augment`,
        description,
      },
    ],
    supportedInterfaces: [
      {
        url: `${baseUrl}/a2a`,
        protocolBinding: "HTTP+JSON",
      },
    ],
  };
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 */
export function augmentBridgeConfigFromEnv(env = process.env) {
  const repos = String(env.HDC_AUGMENT_REPOS ?? "hdc")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const delegatableBy = String(env.HDC_AUGMENT_DELEGATABLE_BY ?? "hdc-engineer,hdc-sre-engineer")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    name: String(env.HDC_AUGMENT_BRIDGE_NAME ?? "cursor-cloud-bridge").trim() || "cursor-cloud-bridge",
    runtime: String(env.HDC_AUGMENT_RUNTIME ?? "cursor-cloud").trim() || "cursor-cloud",
    port: Number(env.HDC_AUGMENT_BRIDGE_PORT ?? env.PORT ?? 9210),
    token: String(env.HDC_AUGMENT_BRIDGE_TOKEN ?? "").trim(),
    repos,
    delegatableBy,
    description: String(env.HDC_AUGMENT_DESCRIPTION ?? "").trim(),
    workspace: String(env.HDC_AUGMENT_WORKSPACE ?? "").trim(),
    cliCommand: String(env.HDC_AUGMENT_CLI_COMMAND ?? "").trim(),
    cursorApiKey: String(env.HDC_CURSOR_CLOUD_API_KEY ?? env.CURSOR_API_KEY ?? "").trim(),
    cursorRepositoryUrl: String(env.HDC_AUGMENT_REPOSITORY_URL ?? "").trim(),
    cursorRef: String(env.HDC_AUGMENT_REPOSITORY_REF ?? "main").trim(),
  };
}
