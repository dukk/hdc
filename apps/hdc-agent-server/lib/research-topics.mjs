import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { parseFrontmatter, sanitizeTaskId } from "./operations-fs.mjs";

export const RESEARCH_DIR = "operations/research";
export const TOPICS_DIR = "operations/research/topics";
export const SUGGESTIONS_REL = "operations/research/suggestions.md";
export const INDEX_REL = "operations/research/index.md";

export const TOPIC_STATUSES = /** @type {const} */ ([
  "suggested",
  "queued",
  "in_progress",
  "done",
  "deferred",
  "rejected",
]);

export const TOPIC_OUTCOMES = /** @type {const} */ ([
  "adopt",
  "manual-only",
  "defer",
  "reject",
]);

export const TOPIC_PRIORITIES = /** @type {const} */ (["critical", "high", "medium", "low"]);

/**
 * @param {string} privateRoot
 */
export function researchDir(privateRoot) {
  return join(privateRoot, RESEARCH_DIR);
}

/**
 * @param {string} privateRoot
 */
export function topicsDir(privateRoot) {
  return join(privateRoot, TOPICS_DIR);
}

/**
 * @param {string} privateRoot
 */
export function suggestionsPath(privateRoot) {
  return join(privateRoot, SUGGESTIONS_REL);
}

/**
 * @param {string} privateRoot
 */
export function indexPath(privateRoot) {
  return join(privateRoot, INDEX_REL);
}

/**
 * @param {string} privateRoot
 * @param {string} id
 */
export function topicFilePath(privateRoot, id) {
  return join(topicsDir(privateRoot), `${sanitizeTaskId(id)}.md`);
}

/**
 * @param {Record<string, unknown>} meta
 * @param {string} body
 */
export function validateTopicFrontmatter(meta, body = "") {
  const id = String(meta.id ?? "").trim();
  if (!id) throw new Error("topic frontmatter: id is required");

  const status = String(meta.status ?? "suggested").trim();
  if (!TOPIC_STATUSES.includes(/** @type {typeof TOPIC_STATUSES[number]} */ (status))) {
    throw new Error(`topic frontmatter: invalid status ${JSON.stringify(status)}`);
  }

  const priority = String(meta.priority ?? "low").trim();
  if (!TOPIC_PRIORITIES.includes(/** @type {typeof TOPIC_PRIORITIES[number]} */ (priority))) {
    throw new Error(`topic frontmatter: invalid priority ${JSON.stringify(priority)}`);
  }

  const outcome = String(meta.outcome ?? "").trim();
  if (outcome && !TOPIC_OUTCOMES.includes(/** @type {typeof TOPIC_OUTCOMES[number]} */ (outcome))) {
    throw new Error(`topic frontmatter: invalid outcome ${JSON.stringify(outcome)}`);
  }

  return {
    id,
    title: String(meta.title ?? id).trim() || id,
    status: /** @type {typeof TOPIC_STATUSES[number]} */ (status),
    priority: /** @type {typeof TOPIC_PRIORITIES[number]} */ (priority),
    url: typeof meta.url === "string" && meta.url.trim() ? meta.url.trim() : "",
    suggested_by:
      typeof meta.suggested_by === "string" && meta.suggested_by.trim()
        ? meta.suggested_by.trim()
        : "operator",
    report: typeof meta.report === "string" && meta.report.trim() ? meta.report.trim() : "",
    outcome: outcome
      ? /** @type {typeof TOPIC_OUTCOMES[number]} */ (outcome)
      : /** @type {""} */ (""),
    created_at: String(meta.created_at ?? new Date().toISOString()).trim(),
    updated_at: String(meta.updated_at ?? new Date().toISOString()).trim(),
    body: String(body ?? "").trim(),
  };
}

/**
 * @param {ReturnType<typeof validateTopicFrontmatter>} topic
 */
export function serializeTopic(topic) {
  /** @type {string[]} */
  const lines = ["---"];
  lines.push(`id: ${topic.id}`);
  lines.push(`title: ${JSON.stringify(topic.title)}`);
  lines.push(`status: ${topic.status}`);
  lines.push(`priority: ${topic.priority}`);
  if (topic.url) lines.push(`url: ${topic.url}`);
  lines.push(`suggested_by: ${topic.suggested_by}`);
  if (topic.report) lines.push(`report: ${topic.report}`);
  if (topic.outcome) lines.push(`outcome: ${topic.outcome}`);
  lines.push(`created_at: ${topic.created_at}`);
  lines.push(`updated_at: ${topic.updated_at}`);
  lines.push("---");
  if (topic.body) {
    lines.push("");
    lines.push(topic.body);
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * @param {string} privateRoot
 */
export function listTopics(privateRoot) {
  const dir = topicsDir(privateRoot);
  if (!existsSync(dir)) return [];

  /** @type {ReturnType<typeof validateTopicFrontmatter>[]} */
  const topics = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".md")) continue;
    try {
      topics.push(readTopic(privateRoot, name.replace(/\.md$/, "")));
    } catch {
      /* skip invalid */
    }
  }
  return sortTopics(topics);
}

/**
 * @param {ReturnType<typeof validateTopicFrontmatter>[]} topics
 */
export function sortTopics(topics) {
  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  return [...topics].sort((a, b) => {
    const pd = priorityOrder[a.priority] - priorityOrder[b.priority];
    if (pd !== 0) return pd;
    return a.created_at.localeCompare(b.created_at);
  });
}

/**
 * @param {string} privateRoot
 * @param {string} id
 */
export function readTopic(privateRoot, id) {
  const path = topicFilePath(privateRoot, id);
  if (!existsSync(path)) {
    throw new Error(`research topic not found: ${id}`);
  }
  const raw = readFileSync(path, "utf8");
  const { meta, body } = parseFrontmatter(raw);
  return validateTopicFrontmatter(meta, body);
}

/**
 * @param {string} privateRoot
 * @param {ReturnType<typeof validateTopicFrontmatter>} topic
 */
export function writeTopic(privateRoot, topic) {
  const validated = validateTopicFrontmatter(
    {
      ...topic,
      updated_at: topic.updated_at || new Date().toISOString(),
    },
    topic.body,
  );
  mkdirSync(topicsDir(privateRoot), { recursive: true });
  writeFileSync(topicFilePath(privateRoot, validated.id), serializeTopic(validated), "utf8");
  return validated;
}

/**
 * @param {string} privateRoot
 * @param {string} id
 * @param {Partial<ReturnType<typeof validateTopicFrontmatter>>} patch
 */
export function updateTopic(privateRoot, id, patch) {
  const current = readTopic(privateRoot, id);
  const next = validateTopicFrontmatter(
    {
      ...current,
      ...patch,
      id: current.id,
      updated_at: new Date().toISOString(),
    },
    patch.body !== undefined ? patch.body : current.body,
  );
  return writeTopic(privateRoot, next);
}

/**
 * @param {string} privateRoot
 */
export function listQueuedTopics(privateRoot) {
  return listTopics(privateRoot).filter((t) => t.status === "queued");
}

/**
 * @param {string} privateRoot
 */
export function readSuggestions(privateRoot) {
  const path = suggestionsPath(privateRoot);
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf8");
}

/**
 * @param {string} privateRoot
 * @param {{ title: string; body?: string; url?: string; source?: string }} input
 */
export function appendSuggestion(privateRoot, input) {
  const title = String(input.title ?? "").trim();
  if (!title) throw new Error("suggestion title is required");

  mkdirSync(researchDir(privateRoot), { recursive: true });
  const path = suggestionsPath(privateRoot);
  const now = new Date().toISOString();
  const source = String(input.source ?? "operator").trim() || "operator";
  const url = String(input.url ?? "").trim();
  const body = String(input.body ?? "").trim();

  /** @type {string[]} */
  const block = [
    `## ${now} — ${title}`,
    "",
    `- **Source:** ${source}`,
  ];
  if (url) block.push(`- **URL:** ${url}`);
  block.push("");
  if (body) {
    block.push(body);
    block.push("");
  }
  block.push("---");
  block.push("");

  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const header =
    existing.trim() ||
    [
      "# Research suggestions",
      "",
      "Inbox for new research topics. Manager triage promotes entries to",
      "`operations/research/topics/<id>.md` with `status: queued`.",
      "",
      "Ways to suggest:",
      "- Edit this file directly",
      "- hdc-web-server **Research** tab",
      "- Email `manager@hdc.dukk.org` with subject `Research: <title>`",
      "",
      "---",
      "",
    ].join("\n");

  const sep = header.endsWith("\n") ? "" : "\n";
  writeFileSync(path, `${header}${sep}${block.join("\n")}`, "utf8");
  return { path, title, source, at: now };
}

/**
 * @param {ReturnType<typeof validateTopicFrontmatter>[]} topics
 * @param {{ source?: string; now?: string }} [opts]
 */
export function renderResearchIndex(topics, opts = {}) {
  const now = opts.now ?? new Date().toISOString();
  const source = opts.source ?? "hdc-research";
  const sorted = sortTopics(topics);

  /** @type {string[]} */
  const lines = [
    "# HDC Research Index",
    "",
    `Last updated: ${now} (${source})`,
    "",
    "| ID | Title | Status | Outcome | Report | Suggested by | Updated |",
    "|----|-------|--------|---------|--------|--------------|---------|",
  ];

  for (const t of sorted) {
    const title = t.title.replace(/\|/g, "\\|");
    const report = t.report ? `[report](${t.report})` : "";
    lines.push(
      `| ${t.id} | ${title} | ${t.status} | ${t.outcome || "—"} | ${report} | ${t.suggested_by} | ${t.updated_at} |`,
    );
  }

  if (sorted.length === 0) {
    lines.push("| _none_ | | | | | | |");
  }

  lines.push("");
  return lines.join("\n");
}

/**
 * @param {string} privateRoot
 * @param {{ source?: string }} [opts]
 */
export function writeResearchIndex(privateRoot, opts = {}) {
  const topics = listTopics(privateRoot);
  const md = renderResearchIndex(topics, opts);
  mkdirSync(researchDir(privateRoot), { recursive: true });
  writeFileSync(indexPath(privateRoot), md, "utf8");
  return indexPath(privateRoot);
}

/**
 * Slugify a title for topic ids (lowercase, hyphens, max 40).
 * @param {string} title
 */
export function slugifyTopicTitle(title) {
  const s = String(title ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return s || "topic";
}

/**
 * Queue a research topic from an engineer agent (bypasses suggestion inbox).
 * @param {string} privateRoot
 * @param {{
 *   title: string,
 *   suggested_by: string,
 *   notes?: string,
 *   url?: string,
 *   priority?: string,
 *   id?: string,
 * }} input
 */
export function queueTopicFromAgent(privateRoot, input) {
  const title = String(input.title ?? "").trim();
  if (!title) throw new Error("title is required");
  const suggestedBy = String(input.suggested_by ?? "").trim();
  if (!suggestedBy) throw new Error("suggested_by is required");

  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  let id = String(input.id ?? "").trim();
  if (!id) {
    id = `eng-req-${date}-${slugifyTopicTitle(title)}`;
  }
  id = sanitizeTaskId(id);

  if (existsSync(topicFilePath(privateRoot, id))) {
    let n = 2;
    while (existsSync(topicFilePath(privateRoot, `${id}-${n}`)) && n < 50) n += 1;
    id = sanitizeTaskId(`${id}-${n}`);
  }

  const topic = writeTopic(privateRoot, {
    ...validateTopicFrontmatter(
      {
        id,
        title,
        status: "queued",
        priority: input.priority || "medium",
        suggested_by: suggestedBy,
        url: input.url || "",
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
      },
      input.notes || "",
    ),
  });
  writeResearchIndex(privateRoot, { source: `queue-from-${suggestedBy}` });
  return topic;
}

/**
 * @param {string} privateRoot
 * @param {string} suggestionTitle
 * @param {Partial<ReturnType<typeof validateTopicFrontmatter>> & { id: string }} topicInput
 */
export function promoteSuggestionToTopic(privateRoot, suggestionTitle, topicInput) {
  const topic = writeTopic(privateRoot, {
    ...validateTopicFrontmatter(
      {
        status: "queued",
        priority: "low",
        suggested_by: "manager",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...topicInput,
      },
      topicInput.body ?? "",
    ),
  });
  appendSuggestion(privateRoot, {
    title: `(promoted) ${suggestionTitle}`,
    body: `Promoted to topic \`${topic.id}\` with status queued.`,
    source: "manager",
  });
  writeResearchIndex(privateRoot, { source: "promote-suggestion" });
  return topic;
}

/**
 * @param {string} privateRoot
 */
export function getResearchApiPayload(privateRoot) {
  const topics = listTopics(privateRoot);
  return {
    index: existsSync(indexPath(privateRoot)) ? readFileSync(indexPath(privateRoot), "utf8") : "",
    suggestions: readSuggestions(privateRoot),
    topics: topics.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      outcome: t.outcome || null,
      report: t.report || null,
      url: t.url || null,
      suggested_by: t.suggested_by,
      updated_at: t.updated_at,
      created_at: t.created_at,
    })),
  };
}
