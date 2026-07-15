import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  matchesAugmentorCriteria,
  parseAugmentorMetadata,
} from "../../hdc-cli/lib/litellm-a2a-metadata.mjs";

/**
 * @param {string} privateRoot
 * @returns {unknown[]}
 */
export function loadA2aAgentsFromLitellmConfig(privateRoot) {
  if (!privateRoot) return [];
  const paths = [
    join(privateRoot, "clumps", "services", "litellm", "config.json"),
    join(privateRoot, "clumps", "services", "litellm", "config.example.json"),
  ];
  for (const p of paths) {
    if (!existsSync(p)) continue;
    try {
      const raw = JSON.parse(readFileSync(p, "utf8"));
      const defaults = raw?.defaults?.litellm ?? raw?.litellm;
      const fromDefaults = defaults?.a2a_agents;
      if (Array.isArray(fromDefaults) && fromDefaults.length) return fromDefaults;
      const deployments = raw?.deployments;
      if (Array.isArray(deployments)) {
        for (const d of deployments) {
          const agents = d?.litellm?.a2a_agents;
          if (Array.isArray(agents) && agents.length) return agents;
        }
      }
    } catch {
      /* try next */
    }
  }
  return [];
}

/**
 * @param {string} privateRoot
 * @returns {Record<string, unknown> | null}
 */
export function loadHdcAgentsAugmentationConfig(privateRoot) {
  if (!privateRoot) return null;
  const paths = [
    join(privateRoot, "clumps", "services", "hdc-agents", "config.json"),
    join(privateRoot, "clumps", "services", "hdc-agents", "config.example.json"),
  ];
  for (const p of paths) {
    if (!existsSync(p)) continue;
    try {
      const raw = JSON.parse(readFileSync(p, "utf8"));
      const agents = raw?.defaults?.hdc_agents ?? raw?.hdc_agents;
      if (agents?.augmentation && typeof agents.augmentation === "object") {
        return /** @type {Record<string, unknown>} */ (agents.augmentation);
      }
    } catch {
      /* next */
    }
  }
  return null;
}

/**
 * @param {string} privateRoot
 */
export function isAugmentationEnabled(privateRoot) {
  const aug = loadHdcAgentsAugmentationConfig(privateRoot);
  if (!aug) return false;
  return aug.enabled !== false;
}

/**
 * @param {object} opts
 * @param {string} [opts.baseUrl]
 * @param {string} [opts.apiKey]
 * @param {string} [opts.privateRoot]
 * @param {typeof fetch} [opts.fetchImpl]
 */
export async function listA2aAgents(opts = {}) {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const baseUrl = String(opts.baseUrl ?? process.env.HDC_LITELLM_BASE_URL ?? "http://127.0.0.1:4000").replace(
    /\/$/,
    "",
  );
  const apiKey = String(
    opts.apiKey ??
      process.env.HDC_AGENT_LITELLM_KEY ??
      process.env.HDC_LITELLM_MASTER_KEY ??
      "",
  ).trim();

  if (apiKey) {
    for (const path of ["/v1/agents", "/agents", "/v1/a2a/agents"]) {
      try {
        const res = await fetchImpl(`${baseUrl}${path}`, {
          headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
        });
        if (!res.ok) continue;
        const data = await res.json();
        const list = normalizeAgentListResponse(data);
        if (list.length) return list;
      } catch {
        /* fallback */
      }
    }
  }

  const configAgents = loadA2aAgentsFromLitellmConfig(opts.privateRoot ?? process.env.HDC_PRIVATE_ROOT ?? "");
  return configAgents.map((entry) => normalizeConfigAgentEntry(entry));
}

/**
 * @param {unknown} data
 */
function normalizeAgentListResponse(data) {
  if (Array.isArray(data)) return data.map((e) => normalizeConfigAgentEntry(e));
  if (data && typeof data === "object") {
    const o = /** @type {Record<string, unknown>} */ (data);
    if (Array.isArray(o.data)) return o.data.map((e) => normalizeConfigAgentEntry(e));
    if (Array.isArray(o.agents)) return o.agents.map((e) => normalizeConfigAgentEntry(e));
  }
  return [];
}

/**
 * @param {unknown} entry
 */
function normalizeConfigAgentEntry(entry) {
  if (!entry || typeof entry !== "object") return { name: "", url: "" };
  const o = /** @type {Record<string, unknown>} */ (entry);
  const name =
    typeof o.name === "string"
      ? o.name.trim()
      : typeof o.agent_name === "string"
        ? o.agent_name.trim()
        : "";
  const url =
    typeof o.url === "string"
      ? o.url.trim()
      : typeof o.agent_card_url === "string"
        ? o.agent_card_url.trim()
        : "";
  return { ...o, name, url };
}

/**
 * @param {unknown[]} agents
 * @param {{ delegatorRole?: string, repo?: string }} criteria
 */
export function filterAugmentors(agents, criteria) {
  return agents.filter((entry) => matchesAugmentorCriteria(entry, criteria));
}

/**
 * Pick the first matching augmentor; prefers exact runtime match when provided.
 * @param {unknown[]} agents
 * @param {{ delegatorRole: string, repo: string, augmentorName?: string, preferredRuntime?: string }} criteria
 */
export function pickAugmentor(agents, criteria) {
  const matches = filterAugmentors(agents, {
    delegatorRole: criteria.delegatorRole,
    repo: criteria.repo,
  });
  if (!matches.length) return null;
  if (criteria.augmentorName) {
    const named = matches.find(
      (a) =>
        a &&
        typeof a === "object" &&
        String(/** @type {Record<string, unknown>} */ (a).name ?? "").trim() ===
          criteria.augmentorName?.trim(),
    );
    if (named) return named;
    return null;
  }
  if (criteria.preferredRuntime) {
    const pref = matches.find((a) => {
      const meta = parseAugmentorMetadata(null, a);
      return meta.runtime === criteria.preferredRuntime;
    });
    if (pref) return pref;
  }
  return matches[0];
}

/**
 * @param {object} opts
 * @param {string} opts.gatewayUrl
 * @param {string} opts.agentName
 * @param {string} [opts.apiKey]
 * @param {string} [opts.upstreamUrl]
 * @param {typeof fetch} [opts.fetchImpl]
 */
export async function fetchAgentCard(opts) {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const apiKey = String(opts.apiKey ?? "").trim();
  const gateway = String(opts.gatewayUrl ?? "").replace(/\/$/, "");
  const name = String(opts.agentName ?? "").trim();
  const headers = /** @type {Record<string, string>} */ ({
    Accept: "application/json",
  });
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const urls = [];
  if (gateway && name) {
    urls.push(`${gateway}/a2a/${encodeURIComponent(name)}/.well-known/agent.json`);
    urls.push(`${gateway}/a2a/${encodeURIComponent(name)}/agent-card`);
  }
  const upstream = String(opts.upstreamUrl ?? "").replace(/\/$/, "");
  if (upstream) {
    urls.push(`${upstream}/.well-known/agent.json`);
    urls.push(`${upstream}/.well-known/agent-card.json`);
    urls.push(`${upstream}/a2a/agent-card`);
  }

  for (const url of urls) {
    try {
      const res = await fetchImpl(url, { headers });
      if (!res.ok) continue;
      return await res.json();
    } catch {
      /* next */
    }
  }
  return null;
}

/**
 * @param {object} opts
 * @param {string} opts.gatewayUrl
 * @param {string} opts.agentName
 * @param {string} opts.text
 * @param {string} [opts.apiKey]
 * @param {string} [opts.contextId]
 * @param {typeof fetch} [opts.fetchImpl]
 */
export async function postA2aMessage(opts) {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const gateway = String(opts.gatewayUrl ?? process.env.HDC_LITELLM_BASE_URL ?? "http://127.0.0.1:4000").replace(
    /\/$/,
    "",
  );
  const agentName = String(opts.agentName ?? "").trim();
  const apiKey = String(
    opts.apiKey ??
      process.env.HDC_AGENT_LITELLM_KEY ??
      process.env.HDC_LITELLM_MASTER_KEY ??
      "",
  ).trim();
  if (!agentName) throw new Error("postA2aMessage: agentName is required");
  if (!apiKey) throw new Error("postA2aMessage: LiteLLM API key is required");

  const body = {
    jsonrpc: "2.0",
    id: `delegate-${Date.now()}`,
    method: "message/send",
    params: {
      message: {
        role: "user",
        parts: [{ kind: "text", text: String(opts.text ?? "") }],
      },
      ...(opts.contextId ? { contextId: opts.contextId } : {}),
    },
  };

  const res = await fetchImpl(`${gateway}/a2a/${encodeURIComponent(agentName)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "A2A-Version": "0.3.0",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`A2A ${agentName} ${res.status}: ${text.slice(0, 500)}`);
  }
  return data;
}

/**
 * @param {object} opts
 * @param {string} opts.delegatorRole
 * @param {string} opts.repo
 * @param {string} [opts.privateRoot]
 * @param {string} [opts.baseUrl]
 * @param {string} [opts.apiKey]
 * @param {typeof fetch} [opts.fetchImpl]
 */
export async function listAugmentorsForRole(opts) {
  const agents = await listA2aAgents({
    baseUrl: opts.baseUrl,
    apiKey: opts.apiKey,
    privateRoot: opts.privateRoot,
    fetchImpl: opts.fetchImpl,
  });
  const filtered = filterAugmentors(agents, {
    delegatorRole: opts.delegatorRole,
    repo: opts.repo,
  });
  return filtered.map((entry) => {
    const o = entry && typeof entry === "object" ? /** @type {Record<string, unknown>} */ (entry) : {};
    const meta = parseAugmentorMetadata(null, entry);
    return {
      name: String(o.name ?? ""),
      url: String(o.url ?? ""),
      runtime: meta.runtime ?? null,
      repos: meta.repos,
      delegatable_by: meta.delegatable_by,
      enabled: meta.enabled,
    };
  });
}
