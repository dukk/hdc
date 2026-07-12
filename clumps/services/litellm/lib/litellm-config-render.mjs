import {
  normalizeBackends,
  normalizeModelList,
  ollamaBackendEnvVar,
  openaiBackendEnvVar,
} from "./litellm-render.mjs";

/** @param {unknown} v */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * @param {string} s
 */
function yamlQuote(s) {
  if (/^[a-zA-Z0-9_./:@-]+$/.test(s)) return s;
  return JSON.stringify(s);
}

/**
 * @param {string} key
 * @param {unknown} value
 * @param {number} indent
 */
function yamlLine(key, value, indent = 0) {
  const pad = " ".repeat(indent);
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return `${pad}${key}: ${value ? "true" : "false"}`;
  if (typeof value === "number" && Number.isFinite(value)) return `${pad}${key}: ${value}`;
  return `${pad}${key}: ${yamlQuote(String(value))}`;
}

/**
 * @param {unknown} fallbacks
 * @returns {string[]}
 */
function renderFallbacksYaml(fallbacks) {
  if (!Array.isArray(fallbacks) || fallbacks.length === 0) return [];
  /** @type {string[]} */
  const lines = ["  fallbacks:"];
  for (const item of fallbacks) {
    if (!isObject(item)) continue;
    for (const [from, toList] of Object.entries(item)) {
      if (Array.isArray(toList)) {
        lines.push(`    - ${from}: ${JSON.stringify(toList)}`);
      }
    }
  }
  return lines.length > 1 ? lines : [];
}

/**
 * @param {Record<string, unknown>} litellm
 */
export function renderLitellmConfigYaml(litellm) {
  const cfg = isObject(litellm) ? litellm : {};
  const backends = normalizeBackends(cfg);
  const models = normalizeModelList(cfg.model_list, backends);

  /** @type {string[]} */
  const lines = ["# hdc-generated — LiteLLM config.yaml", "model_list:"];

  for (const entry of models) {
    lines.push("  -");
    lines.push(yamlLine("model_name", entry.model_name, 4));
    lines.push("    litellm_params:");
    if (entry.provider === "ollama") {
      lines.push(yamlLine("model", `ollama/${entry.model}`, 6));
      const backendId = entry.ollama_backend_id ?? backends.ollama[0]?.id;
      if (backendId) {
        lines.push(yamlLine("api_base", `os.environ/${ollamaBackendEnvVar(backendId)}`, 6));
      }
    } else if (entry.provider === "openai") {
      lines.push(yamlLine("model", `openai/${entry.model}`, 6));
      const backendId = entry.openai_backend_id ?? backends.openai[0]?.id;
      if (backendId) {
        lines.push(yamlLine("api_base", `os.environ/${openaiBackendEnvVar(backendId)}`, 6));
      }
      // vLLM has no auth; LiteLLM still expects a key field for openai/* — use a placeholder
      lines.push(yamlLine("api_key", "EMPTY", 6));
    } else if (entry.provider === "openrouter") {
      lines.push(yamlLine("model", `openrouter/${entry.model}`, 6));
      lines.push(yamlLine("api_key", "os.environ/OPENROUTER_API_KEY", 6));
    }
  }

  const litellmSettings = isObject(cfg.litellm_settings) ? cfg.litellm_settings : {};
  if (Object.keys(litellmSettings).length > 0) {
    lines.push("litellm_settings:");
    for (const [key, val] of Object.entries(litellmSettings)) {
      if (val === null || val === undefined) continue;
      lines.push(yamlLine(key, val, 2));
    }
  }

  const routerSettings = isObject(cfg.router_settings) ? cfg.router_settings : {};
  const fallbackLines = renderFallbacksYaml(routerSettings.fallbacks);
  if (fallbackLines.length > 0) {
    lines.push("router_settings:");
    lines.push(...fallbackLines);
  }

  lines.push("general_settings:");
  lines.push(yamlLine("master_key", "os.environ/LITELLM_MASTER_KEY", 2));
  lines.push(yamlLine("database_url", "os.environ/DATABASE_URL", 2));

  return `${lines.filter(Boolean).join("\n")}\n`;
}
