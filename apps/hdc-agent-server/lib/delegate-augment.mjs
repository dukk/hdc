import { createHash } from "node:crypto";

import {
  createTask,
  readTask,
  sanitizeTaskId,
  updateTaskStatus,
} from "./operations-fs.mjs";
import {
  isAugmentationEnabled,
  listA2aAgents,
  pickAugmentor,
  postA2aMessage,
} from "./litellm-a2a.mjs";

const ENGINEER_ROLES = new Set(["hdc-engineer", "hdc-sre-engineer"]);
const REPO_BY_ROLE = {
  "hdc-engineer": "hdc",
  "hdc-sre-engineer": "hdc-clumps",
};

/**
 * @param {string} parentId
 * @param {string} [slug]
 */
export function buildAugmentSubtaskId(parentId, slug = "slice") {
  const parent = sanitizeTaskId(parentId);
  const safeSlug = String(slug ?? "slice")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  const hash = createHash("sha256").update(`${parent}:${safeSlug}:${Date.now()}`).digest("hex").slice(0, 6);
  return `${parent}--aug-${safeSlug || "slice"}-${hash}`;
}

/**
 * @param {object} opts
 * @param {string} opts.privateRoot
 * @param {string} opts.delegatorRole
 * @param {string} opts.parentTaskId
 * @param {string} opts.repo
 * @param {string} opts.prompt
 * @param {string} [opts.augmentorName]
 * @param {boolean} [opts.wait]
 * @param {string} [opts.litellmBaseUrl]
 * @param {string} [opts.litellmApiKey]
 * @param {typeof fetch} [opts.fetchImpl]
 */
export async function delegateAugmentSubtask(opts) {
  const role = String(opts.delegatorRole ?? "").trim();
  if (!ENGINEER_ROLES.has(role)) {
    throw new Error(`delegation is only allowed for hdc-engineer and hdc-sre-engineer (got ${JSON.stringify(role)})`);
  }
  if (!opts.privateRoot) {
    throw new Error("HDC_PRIVATE_ROOT is required for augmentor delegation");
  }
  if (!isAugmentationEnabled(opts.privateRoot)) {
    throw new Error("augmentation is disabled in hdc-agents config (hdc_agents.augmentation.enabled)");
  }

  const repo = String(opts.repo ?? REPO_BY_ROLE[/** @type {keyof typeof REPO_BY_ROLE} */ (role)] ?? "").trim();
  if (repo !== "hdc" && repo !== "hdc-clumps") {
    throw new Error(`repo must be "hdc" or "hdc-clumps" (got ${JSON.stringify(opts.repo)})`);
  }
  if (repo !== REPO_BY_ROLE[/** @type {keyof typeof REPO_BY_ROLE} */ (role)]) {
    throw new Error(`${role} may only delegate repo ${REPO_BY_ROLE[/** @type {keyof typeof REPO_BY_ROLE} */ (role)]}`);
  }

  const parentId = sanitizeTaskId(opts.parentTaskId);
  const parent = readTask(opts.privateRoot, parentId);
  if (parent.role !== role) {
    throw new Error(`parent task ${parentId} role ${parent.role} does not match delegator ${role}`);
  }

  const prompt = String(opts.prompt ?? "").trim();
  if (!prompt) throw new Error("prompt is required for augmentor delegation");

  const agents = await listA2aAgents({
    privateRoot: opts.privateRoot,
    baseUrl: opts.litellmBaseUrl,
    apiKey: opts.litellmApiKey,
    fetchImpl: opts.fetchImpl,
  });
  const augmentor = pickAugmentor(agents, {
    delegatorRole: role,
    repo,
    augmentorName: opts.augmentorName,
  });
  if (!augmentor || typeof augmentor !== "object") {
    throw new Error(`no augmentor registered for repo=${repo} delegator=${role}`);
  }
  const augmentorName = String(/** @type {Record<string, unknown>} */ (augmentor).name ?? "").trim();
  if (!augmentorName) throw new Error("selected augmentor has no name");

  const subtaskId = buildAugmentSubtaskId(parentId, "slice");
  const subtask = createTask(opts.privateRoot, {
    id: subtaskId,
    role,
    priority: parent.priority,
    status: "in_progress",
    title: `Augment: ${parent.title}`.slice(0, 120),
    parent_task_id: parentId,
    delegated_to: augmentorName,
    delegation_status: "pending",
    evidence: parent.evidence,
    body: prompt,
  });

  const payload = [
    `# Augmentor subtask`,
    ``,
    `parent_task_id: ${parentId}`,
    `subtask_id: ${subtaskId}`,
    `repo: ${repo}`,
    `delegator_role: ${role}`,
    ``,
    `## Instructions`,
    prompt,
    ``,
    `## Constraints`,
    `- Edit only the ${repo} repository.`,
    `- Do not run deploy, teardown, maintain --prune, or change hdc-private live state.`,
    `- Reply with a concise summary, branch name, and commit SHA when done.`,
  ].join("\n");

  const gatewayUrl = String(
    opts.litellmBaseUrl ?? process.env.HDC_LITELLM_BASE_URL ?? "http://127.0.0.1:4000",
  ).replace(/\/$/, "");
  const apiKey = String(
    opts.litellmApiKey ??
      process.env.HDC_AGENT_LITELLM_KEY ??
      process.env[`HDC_AGENT_LITELLM_KEY_${role.replace(/-/g, "_").toUpperCase()}`] ??
      process.env.HDC_LITELLM_MASTER_KEY ??
      "",
  ).trim();

  let a2aResponse = null;
  let augmentorRunId;
  try {
    a2aResponse = await postA2aMessage({
      gatewayUrl,
      agentName: augmentorName,
      apiKey,
      text: payload,
      fetchImpl: opts.fetchImpl,
    });
    augmentorRunId = extractAugmentorRunId(a2aResponse);
    updateTaskStatus(opts.privateRoot, subtaskId, {
      delegation_status: "in_progress",
      augmentor_run_id: augmentorRunId,
    });
  } catch (e) {
    updateTaskStatus(opts.privateRoot, subtaskId, {
      delegation_status: "failed",
      blocked_reason: String(/** @type {Error} */ (e).message || e).slice(0, 500),
      status: "blocked",
    });
    throw e;
  }

  if (opts.wait) {
    // v1: synchronous wait not implemented — augmentors return async task ids
  }

  return {
    ok: true,
    parent_task_id: parentId,
    subtask_id: subtaskId,
    augmentor_name: augmentorName,
    augmentor_run_id: augmentorRunId ?? null,
    delegation_status: "in_progress",
    a2a_response: summarizeA2aResponse(a2aResponse),
    subtask,
  };
}

/**
 * @param {unknown} response
 */
function summarizeA2aResponse(response) {
  if (!response || typeof response !== "object") return response;
  const o = /** @type {Record<string, unknown>} */ (response);
  if (o.result && typeof o.result === "object") {
    const r = /** @type {Record<string, unknown>} */ (o.result);
    return {
      taskId: r.taskId ?? r.task_id ?? null,
      status: r.status ?? null,
    };
  }
  return { id: o.id ?? null };
}

/**
 * @param {unknown} response
 */
function extractAugmentorRunId(response) {
  if (!response || typeof response !== "object") return undefined;
  const o = /** @type {Record<string, unknown>} */ (response);
  const result = o.result && typeof o.result === "object" ? /** @type {Record<string, unknown>} */ (o.result) : o;
  const id =
    result.taskId ??
    result.task_id ??
    result.runId ??
    result.run_id ??
    result.agentId ??
    result.agent_id;
  return id != null ? String(id) : undefined;
}
