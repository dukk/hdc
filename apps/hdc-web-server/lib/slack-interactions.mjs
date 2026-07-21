/**
 * Slack Interactivity endpoint helpers for HDC Approve/Deny buttons.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

import { parseSlackDecisionActionId } from "../../hdc-cli/lib/ops-slack-app-notify.mjs";
import { applyTaskDecision } from "./task-decision.mjs";

export const SLACK_SIGNING_SECRET_ENV = "HDC_SLACK_HDC_APP_SIGNING_SECRET";
export const SLACK_DECISION_AUTHORIZED_USERS_ENV = "HDC_SLACK_DECISION_AUTHORIZED_USERS";
export const SLACK_SIGNATURE_MAX_SKEW_SEC = 60 * 5;

/**
 * @param {import("node:http").IncomingMessage} req
 * @returns {Promise<Buffer>}
 */
export function readRawBody(req) {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = [];
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function resolveSlackSigningSecret(env = process.env) {
  return String(env[SLACK_SIGNING_SECRET_ENV] ?? "").trim();
}

/**
 * Comma-separated Slack usernames and/or user ids (`U…`) allowed to Approve/Deny.
 * Empty list = no restriction (backward compatible).
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string[]}
 */
export function resolveSlackDecisionAuthorizedUsers(env = process.env) {
  const raw = String(env[SLACK_DECISION_AUTHORIZED_USERS_ENV] ?? "").trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * @param {Record<string, unknown>} user
 * @param {string[]} allowlist
 * @returns {boolean}
 */
export function isSlackUserAuthorized(user, allowlist) {
  if (!allowlist.length) return true;
  const username = String(user.username ?? user.name ?? "")
    .trim()
    .toLowerCase();
  const userId = String(user.id ?? "").trim();
  for (const entry of allowlist) {
    const normalized = entry.trim();
    if (!normalized) continue;
    if (normalized.startsWith("U") && normalized === userId) return true;
    if (normalized.toLowerCase() === username) return true;
  }
  return false;
}

/**
 * Verify Slack request signature (v0 HMAC-SHA256).
 *
 * @param {object} opts
 * @param {string} opts.signingSecret
 * @param {string} opts.signatureHeader X-Slack-Signature
 * @param {string} opts.timestampHeader X-Slack-Request-Timestamp
 * @param {string | Buffer} opts.rawBody
 * @param {number} [opts.nowSec]
 * @param {number} [opts.maxSkewSec]
 * @returns {boolean}
 */
export function verifySlackInteractionSignature(opts) {
  const secret = String(opts.signingSecret ?? "").trim();
  const signature = String(opts.signatureHeader ?? "").trim();
  const timestamp = String(opts.timestampHeader ?? "").trim();
  if (!secret || !signature || !timestamp) return false;
  if (!/^\d+$/.test(timestamp)) return false;

  const nowSec = opts.nowSec ?? Math.floor(Date.now() / 1000);
  const maxSkew = opts.maxSkewSec ?? SLACK_SIGNATURE_MAX_SKEW_SEC;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSec - ts) > maxSkew) return false;

  const body = Buffer.isBuffer(opts.rawBody)
    ? opts.rawBody.toString("utf8")
    : String(opts.rawBody ?? "");
  const base = `v0:${timestamp}:${body}`;
  const digest = createHmac("sha256", secret).update(base, "utf8").digest("hex");
  const expected = `v0=${digest}`;
  try {
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(signature, "utf8");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * @param {string | Buffer} rawBody
 * @returns {Record<string, unknown> | null}
 */
export function parseSlackInteractionPayload(rawBody) {
  const body = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody ?? "");
  const params = new URLSearchParams(body);
  const payloadRaw = params.get("payload");
  if (!payloadRaw) return null;
  try {
    const parsed = JSON.parse(payloadRaw);
    return parsed && typeof parsed === "object"
      ? /** @type {Record<string, unknown>} */ (parsed)
      : null;
  } catch {
    return null;
  }
}

/**
 * @param {string} originalText
 * @param {string} outcomeLine
 * @param {string} [username]
 */
export function buildSlackUpdatedDecisionText(originalText, outcomeLine, username) {
  const base = String(originalText ?? "").trim();
  const who = String(username ?? "").trim();
  const outcome = slackMrkdwnFromDecisionMessage(String(outcomeLine ?? "").trim());
  const suffix = who ? `${outcome} (@${who})` : outcome;
  if (!base) return suffix;
  return `${base}\n\n_${suffix}_`;
}

/**
 * Convert shared task-decision copy (Discord-style) to Slack mrkdwn.
 *
 * @param {string} text
 * @returns {string}
 */
export function slackMrkdwnFromDecisionMessage(text) {
  return String(text ?? "").replace(/\*\*/g, "*");
}

/**
 * Synchronous block_actions ack that replaces the original message (no response_url).
 *
 * @param {string} updatedText
 * @returns {Record<string, unknown>}
 */
export function buildSlackReplaceOriginalAck(updatedText) {
  const safe = slackMrkdwnFromDecisionMessage(updatedText).slice(0, 2900);
  return {
    replace_original: true,
    text: safe,
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: safe },
      },
    ],
  };
}

/**
 * @param {string} text
 * @returns {Record<string, unknown>}
 */
function buildSlackEphemeralAck(text) {
  return {
    response_type: "ephemeral",
    text: String(text ?? ""),
  };
}

/**
 * Handle a verified Slack interaction payload (block_actions).
 *
 * @param {object} opts
 * @param {Record<string, unknown>} opts.payload
 * @param {string} opts.privateRoot
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @returns {Promise<{ status: number; body: Record<string, unknown> }>}
 */
export async function handleSlackInteractionPayload(opts) {
  const payload = opts.payload ?? {};
  const env = opts.env ?? process.env;
  const type = String(payload.type ?? "");

  if (type !== "block_actions") {
    return { status: 200, body: buildSlackEphemeralAck("Unsupported interaction.") };
  }

  const actions = Array.isArray(payload.actions) ? payload.actions : [];
  const first =
    actions[0] && typeof actions[0] === "object"
      ? /** @type {Record<string, unknown>} */ (actions[0])
      : {};
  const actionId = typeof first.action_id === "string" ? first.action_id : "";
  const parsed = parseSlackDecisionActionId(actionId) ?? parseDecisionFallback(actionId);
  if (!parsed) {
    return { status: 200, body: buildSlackEphemeralAck("Unknown decision button.") };
  }

  const userObj =
    payload.user && typeof payload.user === "object"
      ? /** @type {Record<string, unknown>} */ (payload.user)
      : {};
  const username =
    typeof userObj.username === "string"
      ? userObj.username
      : typeof userObj.name === "string"
        ? userObj.name
        : "";

  const allowlist = resolveSlackDecisionAuthorizedUsers(env);
  if (!isSlackUserAuthorized(userObj, allowlist)) {
    return {
      status: 200,
      body: {
        response_type: "ephemeral",
        text: "Not authorized to approve/deny HDC tasks.",
      },
    };
  }

  const result = await applyTaskDecision(opts.privateRoot, parsed, {
    user: "slack",
    denyReason: "Operator declined via Slack",
  });

  const messageObj =
    payload.message && typeof payload.message === "object"
      ? /** @type {Record<string, unknown>} */ (payload.message)
      : {};
  const original =
    typeof messageObj.text === "string"
      ? messageObj.text
      : `Task \`${parsed.taskId}\``;
  const updatedText = buildSlackUpdatedDecisionText(original, result.message, username);

  return { status: 200, body: buildSlackReplaceOriginalAck(updatedText) };
}

/**
 * @param {string} actionId
 */
function parseDecisionFallback(actionId) {
  // Re-export path already covers hdc:approve|deny — keep for clarity.
  return parseSlackDecisionActionId(actionId);
}
