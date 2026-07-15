import {
  appendSuggestion,
  getResearchApiPayload,
} from "../../hdc-agent-server/lib/research-topics.mjs";

/**
 * @param {string} privateRoot
 */
export function getResearchPayload(privateRoot) {
  return getResearchApiPayload(privateRoot);
}

/**
 * @param {string} privateRoot
 * @param {Record<string, unknown>} body
 * @param {{ user?: string | null; sessionOnly?: boolean }} auth
 */
export function postResearchSuggestion(privateRoot, body, auth = {}) {
  if (auth.sessionOnly && auth.user === "api-token") {
    return { ok: false, status: 403, error: "session authentication required for suggestions" };
  }

  const title = String(body.title ?? "").trim();
  if (!title) {
    return { ok: false, status: 400, error: "title is required" };
  }

  const url = typeof body.url === "string" ? body.url.trim() : "";
  const text = typeof body.body === "string" ? body.body.trim() : "";
  const source = auth.user ? `web-ui:${auth.user}` : "web-ui";

  const result = appendSuggestion(privateRoot, {
    title,
    url,
    body: text,
    source,
  });

  return { ok: true, status: 201, suggestion: result };
}
