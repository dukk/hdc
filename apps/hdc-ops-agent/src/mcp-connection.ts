import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");

/** Absolute path to hdc-mcp stdio server entry. */
export function hdcMcpServerPath(): string {
  const fromEnv = String(process.env.HDC_MCP_SERVER_PATH ?? "").trim();
  if (fromEnv) return fromEnv;
  return join(repoRoot, "hdc-mcp", "server.mjs");
}

/** Stdio connection params for ADK MCPToolset. */
export function hdcMcpStdioConnection() {
  const serverPath = hdcMcpServerPath();
  return {
    type: "StdioConnectionParams" as const,
    serverParams: {
      command: process.execPath,
      args: [serverPath],
      env: {
        ...process.env,
        HDC_PRIVATE_ROOT: process.env.HDC_PRIVATE_ROOT ?? "",
      },
    },
  };
}

/** Tool names exposed to the ops agent. */
export const OPS_AGENT_TOOL_FILTER = [
  "hdc_maintain_daily",
  "hdc_notify_discord",
  "hdc_list",
  "hdc_run",
] as const;

export function defaultOpsAgentModel(): string {
  return String(process.env.HDC_OPS_AGENT_MODEL ?? "gemini-2.5-flash").trim() || "gemini-2.5-flash";
}
