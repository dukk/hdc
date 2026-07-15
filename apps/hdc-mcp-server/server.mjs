#!/usr/bin/env node
/**
 * hdc-mcp-server — stdio transport exposing safe hdc CLI operations.
 * Per-role allowlists via HDC_AGENT_ROLE / scoped API keys (see lib/policy.mjs, lib/api-keys.mjs).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import {
  handleHdcHelp,
  handleHdcList,
  handleHdcMaintainDaily,
  handleHdcClumpsSync,
  handleHdcNotifyDiscord,
  handleHdcRun,
} from "./lib/tools.mjs";
import { getRolePolicy, resolveAgentRole } from "./lib/policy.mjs";
import { resolveMcpAuth } from "./lib/api-keys.mjs";
import { createHdcMcpContext } from "./lib/hdc-context.mjs";
import { hdcPrivateRoot } from "../hdc-cli/lib/private-repo.mjs";

const { deps, root } = createHdcMcpContext();
const privateRoot = hdcPrivateRoot(root, deps.env) || "";
const auth = resolveMcpAuth({
  env: deps.env,
  privateRoot,
  resolveRole: resolveAgentRole,
});
process.env.HDC_AGENT_ROLE = auth.role;
const role = auth.role;
const rolePolicy = getRolePolicy(role);
const allowedVerbs = [...rolePolicy.runVerbs];

const server = new McpServer({
  name: "hdc-mcp-server",
  version: "1.3.0",
});

/** @param {import("./lib/policy.mjs").McpToolName} name */
function toolAllowed(name) {
  return rolePolicy.tools.has(name);
}

if (toolAllowed("hdc_list")) {
  server.tool("hdc_list", "List hdc clumps (packages) and their available verbs.", {}, async () =>
    handleHdcList(),
  );
}

if (toolAllowed("hdc_help")) {
  server.tool(
    "hdc_help",
    "Show hdc CLI help for optional topics (e.g. run, maintain, secrets).",
    {
      topics: z.array(z.string()).optional().describe("Help topic path segments"),
    },
    async (args) => handleHdcHelp(args),
  );
}

if (toolAllowed("hdc_maintain_daily")) {
  server.tool(
    "hdc_maintain_daily",
    "Run the curated non-destructive hdc maintain daily recipe across configured clumps.",
    {
      dry_run: z.boolean().optional().describe("Plan only; do not execute clump scripts"),
      skip_clients: z.boolean().optional().describe("Skip home client query steps"),
      skip_upgrades: z.boolean().optional().describe("Skip package/image upgrade steps"),
      no_report: z.boolean().optional().describe("Skip writing the markdown report file"),
      report_path: z.string().optional().describe("Override report output path"),
      only: z.array(z.string()).optional().describe("Only run these tier/id refs (e.g. service/bind)"),
      skip: z.array(z.string()).optional().describe("Skip these tier/id refs"),
    },
    async (args) => handleHdcMaintainDaily(args),
  );
}

if (toolAllowed("hdc_run")) {
  server.tool(
    "hdc_run",
    `Run a single hdc clump verb (role ${role}: ${allowedVerbs.join(", ")}). Deploy requires task_id with status approved.`,
    {
      tier: z.string().describe("client, infrastructure (or infra), or service"),
      clump: z.string().describe("Clump manifest id"),
      verb: z.enum(/** @type {[string, ...string[]]} */ (allowedVerbs)).describe("Allowed verb for this role"),
      extra_args: z.array(z.string()).optional().describe("Extra args after --"),
      task_id: z
        .string()
        .optional()
        .describe("operations/tasks/<id> stem; required for deploy (must be status approved)"),
      dry_run: z.boolean().optional().describe("Reserved for future use"),
    },
    async (args) => handleHdcRun(args),
  );
}

if (toolAllowed("hdc_clumps_sync")) {
  server.tool(
    "hdc_clumps_sync",
    "Clone or pull hdc-clumps package repos into the local cache (manager only). Use init on first bootstrap; sync after git updates. Optional ref overrides branch/tag/commit for rollback.",
    {
      action: z
        .enum(["init", "sync"])
        .optional()
        .describe('Clumps subcommand (default: "sync")'),
      repo: z.string().optional().describe("Limit to one repo id from .hdc/clumps-repos.json"),
      ref: z
        .string()
        .optional()
        .describe("One-shot ref override (branch, tag, or commit) for rollback"),
      dry_run: z.boolean().optional().describe("Plan only; do not clone or pull"),
    },
    async (args) => handleHdcClumpsSync(args),
  );
}

if (toolAllowed("hdc_notify_discord")) {
  server.tool(
    "hdc_notify_discord",
    "Post an ops alert to Discord via webhook, or Bot API Approve/Deny buttons when decision+task_id and hdc-ops Discord app env are configured.",
    {
      title: z.string().optional().describe("Message title (default: HDC Ops)"),
      message: z.string().describe("Message body (IPs are redacted)"),
      silent: z.boolean().optional().describe("Suppress @channel ping on success"),
      dry_run: z.boolean().optional().describe("Return payload without sending"),
      decision: z
        .boolean()
        .optional()
        .describe("Attach Approve/Deny buttons when interactive Discord bot config is present"),
      task_id: z
        .string()
        .optional()
        .describe("operations/tasks/<id> stem; required when decision is true"),
    },
    async (args) => handleHdcNotifyDiscord(args),
  );
}

const transport = new StdioServerTransport();
await server.connect(transport);
