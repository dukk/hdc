import { loadRolePrompt, stripFrontmatter } from "./role-prompt.mjs";
import { loadAutomationRules, loadSkillsForRole } from "./skill-load.mjs";
import {
  handleHdcClumpsSync,
  handleHdcDelegateAugment,
  handleHdcHelp,
  handleHdcList,
  handleHdcListAugmentors,
  handleHdcMaintainDaily,
  handleHdcNotifyDiscord,
  handleHdcRun,
} from "../../hdc-mcp-server/lib/tools.mjs";
import { getRolePolicy, resolveAgentRole } from "../../hdc-mcp-server/lib/policy.mjs";

const TOOL_HANDLERS = {
  hdc_list: handleHdcList,
  hdc_help: handleHdcHelp,
  hdc_maintain_daily: handleHdcMaintainDaily,
  hdc_run: handleHdcRun,
  hdc_clumps_sync: handleHdcClumpsSync,
  hdc_notify_discord: handleHdcNotifyDiscord,
  hdc_list_augmentors: handleHdcListAugmentors,
  hdc_delegate_augment: handleHdcDelegateAugment,
};

/**
 * @param {string} role
 */
function openAiToolsForRole(role) {
  const policy = getRolePolicy(role);
  /** @type {object[]} */
  const tools = [];
  if (policy.tools.has("hdc_list")) {
    tools.push({
      type: "function",
      function: {
        name: "hdc_list",
        description: "List hdc clumps and verbs",
        parameters: { type: "object", properties: {} },
      },
    });
  }
  if (policy.tools.has("hdc_help")) {
    tools.push({
      type: "function",
      function: {
        name: "hdc_help",
        description: "CLI help topics",
        parameters: {
          type: "object",
          properties: { topics: { type: "array", items: { type: "string" } } },
        },
      },
    });
  }
  if (policy.tools.has("hdc_run")) {
    tools.push({
      type: "function",
      function: {
        name: "hdc_run",
        description: `Run hdc clump verb (allowed: ${[...policy.runVerbs].join(", ")})`,
        parameters: {
          type: "object",
          required: ["tier", "clump", "verb"],
          properties: {
            tier: { type: "string" },
            clump: { type: "string" },
            verb: { type: "string" },
            extra_args: { type: "array", items: { type: "string" } },
            task_id: { type: "string" },
          },
        },
      },
    });
  }
  if (policy.tools.has("hdc_maintain_daily")) {
    tools.push({
      type: "function",
      function: {
        name: "hdc_maintain_daily",
        description: "Non-destructive daily maintain recipe",
        parameters: {
          type: "object",
          properties: {
            dry_run: { type: "boolean" },
            skip_clients: { type: "boolean" },
            skip_upgrades: { type: "boolean" },
          },
        },
      },
    });
  }
  if (policy.tools.has("hdc_clumps_sync")) {
    tools.push({
      type: "function",
      function: {
        name: "hdc_clumps_sync",
        description:
          "Clone or pull hdc-clumps repos into local cache (init first bootstrap; sync after git updates; optional ref for rollback)",
        parameters: {
          type: "object",
          properties: {
            action: { type: "string", enum: ["init", "sync"] },
            repo: { type: "string" },
            ref: { type: "string" },
            dry_run: { type: "boolean" },
          },
        },
      },
    });
  }
  if (policy.tools.has("hdc_notify_discord")) {
    tools.push({
      type: "function",
      function: {
        name: "hdc_notify_discord",
        description: "Post ops Discord alert (IPs redacted)",
        parameters: {
          type: "object",
          required: ["message"],
          properties: {
            title: { type: "string" },
            message: { type: "string" },
            silent: { type: "boolean" },
          },
        },
      },
    });
  }
  if (policy.tools.has("hdc_list_augmentors")) {
    tools.push({
      type: "function",
      function: {
        name: "hdc_list_augmentors",
        description: "List LiteLLM-registered augmentor agents available for subtask delegation",
        parameters: {
          type: "object",
          properties: {
            repo: { type: "string", enum: ["hdc", "hdc-clumps"] },
          },
        },
      },
    });
  }
  if (policy.tools.has("hdc_delegate_augment")) {
    tools.push({
      type: "function",
      function: {
        name: "hdc_delegate_augment",
        description:
          "Delegate a code-fix subtask to an external augmentor (Cursor/Claude) via LiteLLM A2A",
        parameters: {
          type: "object",
          required: ["parent_task_id", "prompt"],
          properties: {
            parent_task_id: { type: "string" },
            prompt: { type: "string" },
            repo: { type: "string", enum: ["hdc", "hdc-clumps"] },
            augmentor_name: { type: "string" },
            wait: { type: "boolean" },
          },
        },
      },
    });
  }
  return tools;
}

/**
 * @param {object} opts
 * @param {string} opts.role
 * @param {string} opts.message
 * @param {string} opts.hdcRoot
 * @param {string} [opts.privateRoot]
 * @param {Record<string, string>} [opts.litellmHeaders]
 */
export async function runAgentTurn(opts) {
  const role = opts.role || resolveAgentRole();
  process.env.HDC_AGENT_ROLE = role;
  if (opts.privateRoot) process.env.HDC_PRIVATE_ROOT = opts.privateRoot;

  const baseUrl = (process.env.HDC_LITELLM_BASE_URL || "http://127.0.0.1:4000").replace(/\/$/, "");
  const apiKey =
    process.env.HDC_AGENT_LITELLM_KEY ||
    process.env[`HDC_AGENT_LITELLM_KEY_${role.replace(/-/g, "_").toUpperCase()}`] ||
    process.env.HDC_LITELLM_MASTER_KEY ||
    "";
  const model = process.env.HDC_AGENT_MODEL || "lan-best-available";
  const maxRounds = Number(process.env.HDC_AGENT_MAX_ROUNDS || 8);

  const skillText = loadSkillsForRole(opts.hdcRoot, role);
  const rulesText = loadAutomationRules(opts.hdcRoot);
  const system = [
    stripFrontmatter(loadRolePrompt(opts.hdcRoot, role)),
    "",
    skillText ? `---\n${skillText}` : "",
    rulesText ? `---\n## Fleet rules\n${rulesText}` : "",
    "",
    "You act only through the provided hdc tools. Prefer query over maintain. Never invent IPs or secrets.",
    "When finished, reply with a concise summary of actions and findings.",
  ]
    .filter(Boolean)
    .join("\n");

  /** @type {object[]} */
  const messages = [
    { role: "system", content: system },
    { role: "user", content: opts.message },
  ];
  const tools = openAiToolsForRole(role);

  for (let round = 0; round < maxRounds; round++) {
    const response = await chatCompletion({
      baseUrl,
      apiKey,
      model,
      messages,
      tools,
      headers: opts.litellmHeaders ?? {},
    });
    const choice = response?.choices?.[0]?.message;
    if (!choice) throw new Error("LiteLLM returned empty choice");

    messages.push(choice);

    const toolCalls = Array.isArray(choice.tool_calls) ? choice.tool_calls : [];
    if (toolCalls.length === 0) {
      return typeof choice.content === "string" && choice.content.trim()
        ? choice.content.trim()
        : "(no content)";
    }

    for (const call of toolCalls) {
      const name = call?.function?.name;
      const rawArgs = call?.function?.arguments ?? "{}";
      let args = {};
      try {
        args = JSON.parse(rawArgs);
      } catch {
        args = {};
      }
      const handler = TOOL_HANDLERS[/** @type {keyof typeof TOOL_HANDLERS} */ (name)];
      let toolResult;
      if (!handler) {
        toolResult = { error: `unknown tool ${name}` };
      } else {
        const result = await handler(args);
        toolResult = extractToolPayload(result);
      }
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(toolResult).slice(0, 12000),
      });
    }
  }

  return "Agent stopped after max tool rounds without a final message.";
}

/**
 * @param {object} opts
 */
async function chatCompletion(opts) {
  if (!opts.apiKey) {
    throw new Error(
      "No LiteLLM API key (set HDC_AGENT_LITELLM_KEY or HDC_AGENT_LITELLM_KEY_<ROLE> or HDC_LITELLM_MASTER_KEY)",
    );
  }
  /** @type {Record<string, string>} */
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${opts.apiKey}`,
    ...opts.headers,
  };
  const body = {
    model: opts.model,
    messages: opts.messages,
    tools: opts.tools.length ? opts.tools : undefined,
    tool_choice: opts.tools.length ? "auto" : undefined,
  };
  const res = await fetch(`${opts.baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LiteLLM ${res.status}: ${text.slice(0, 500)}`);
  }
  return res.json();
}

/**
 * @param {unknown} result
 */
function extractToolPayload(result) {
  if (!result || typeof result !== "object") return result;
  const r = /** @type {Record<string, unknown>} */ (result);
  if (Array.isArray(r.content) && r.content[0] && typeof r.content[0] === "object") {
    const c = /** @type {Record<string, unknown>} */ (r.content[0]);
    if (typeof c.text === "string") {
      try {
        return JSON.parse(c.text);
      } catch {
        return c.text;
      }
    }
  }
  return r;
}
