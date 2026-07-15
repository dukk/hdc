#!/usr/bin/env node
/**
 * hdc-augment-bridge — A2A 0.3 server wrapping Cursor Cloud / Cursor CLI / Claude Code.
 *
 * Env: HDC_AUGMENT_RUNTIME, HDC_AUGMENT_BRIDGE_NAME, HDC_AUGMENT_BRIDGE_PORT,
 *      HDC_AUGMENT_BRIDGE_TOKEN, HDC_AUGMENT_REPOS, HDC_AUGMENT_DELEGATABLE_BY,
 *      HDC_CURSOR_CLOUD_API_KEY, HDC_AUGMENT_WORKSPACE, HDC_AUGMENT_CLI_COMMAND
 */
import { createAugmentBridgeServer } from "./lib/a2a-server.mjs";
import { augmentBridgeConfigFromEnv } from "./lib/agent-card.mjs";

const config = augmentBridgeConfigFromEnv();
const { server } = createAugmentBridgeServer({ config });

server.listen(config.port, () => {
  process.stderr.write(
    `[hdc-augment-bridge] ${config.name} (${config.runtime}) listening on :${config.port}\n`,
  );
});
