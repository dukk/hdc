#!/usr/bin/env node
/**
 * hdc MCP server — stdio transport exposing safe hdc CLI operations.
 * Per-role allowlists via HDC_AGENT_ROLE (see lib/policy.mjs).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import {
  handleHdcHelp,
  handleHdcList,
  handleHdcMaintainDaily,
  handleHdcNotifyDiscord,
  handleHdcRun,
} from "./lib/tools.mjs";
import { getRolePolicy, resolveAgentRole } from "./lib/policy.mjs";

const role = resolveAgentRole();
const rolePolicy = getRolePolicy(role);
const allowedVerbs = [...rolePolicy.runVerbs];

const server = new McpServer({
  name: "hdc-mcp",
  version: "1.1.0",
});

server.tool("hdc_list", "List hdc clumps (packages) and their available verbs.", {}, async () =>
  handleHdcList(),
);

server.tool(
  "hdc_help",
  "Show hdc CLI help for optional topics (e.g. run, maintain, secrets).",
  {
    topics: z.array(z.string()).optional().describe("Help topic path segments"),
  },
  async (args) => handleHdcHelp(args),
);

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

server.tool(
  "hdc_notify_discord",
  "Post an ops alert to Discord via HDC_OPS_DISCORD_WEBHOOK_URL (vault or env).",
  {
    title: z.string().optional().describe("Message title (default: HDC Ops)"),
    message: z.string().describe("Message body (IPs are redacted)"),
    silent: z.boolean().optional().describe("Suppress @channel ping on success"),
    dry_run: z.boolean().optional().describe("Return payload without sending"),
  },
  async (args) => handleHdcNotifyDiscord(args),
);

const transport = new StdioServerTransport();
await server.connect(transport);
