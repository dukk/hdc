/**
 * Discord Interactions endpoint helpers for hdc-ops Approve/Deny buttons.
 */
import { createPublicKey, verify } from "node:crypto";

import { OPS_DISCORD_PUBLIC_KEY_ENV } from "../../hdc-cli/lib/ops-discord-notify.mjs";
import { patchTaskApi, readTask } from "./tasks.mjs";

export const DISCORD_INTERACTION_PING = 1;
export const DISCORD_INTERACTION_MESSAGE_COMPONENT = 3;
export const DISCORD_CALLBACK_PONG = 1;
export const DISCORD_CALLBACK_UPDATE_MESSAGE = 7;

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
export function resolveOpsDiscordPublicKey(env = process.env) {
  return String(env[OPS_DISCORD_PUBLIC_KEY_ENV] ?? "").trim();
}

/**
 * Verify Discord Ed25519 request signature (Interactions Endpoint).
 *
 * @param {object} opts
 * @param {string} opts.publicKeyHex
 * @param {string} opts.signatureHex
 * @param {string} opts.timestamp
 * @param {string | Buffer} opts.rawBody
 * @returns {boolean}
 */
export function verifyDiscordInteractionSignature(opts) {
  const publicKeyHex = String(opts.publicKeyHex ?? "").trim();
  const signatureHex = String(opts.signatureHex ?? "").trim();
  const timestamp = String(opts.timestamp ?? "").trim();
  if (!publicKeyHex || !signatureHex || !timestamp) return false;
  if (!/^[0-9a-fA-F]+$/.test(publicKeyHex) || publicKeyHex.length !== 64) return false;
  if (!/^[0-9a-fA-F]+$/.test(signatureHex) || signatureHex.length !== 128) return false;

  try {
    // Discord publishes a 32-byte raw Ed25519 public key; wrap as SPKI DER.
    const spkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
    const key = createPublicKey({
      key: Buffer.concat([spkiPrefix, Buffer.from(publicKeyHex, "hex")]),
      format: "der",
      type: "spki",
    });
    const message = Buffer.concat([
      Buffer.from(timestamp, "utf8"),
      Buffer.isBuffer(opts.rawBody) ? opts.rawBody : Buffer.from(String(opts.rawBody ?? ""), "utf8"),
    ]);
    return verify(null, message, key, Buffer.from(signatureHex, "hex"));
  } catch {
    return false;
  }
}

/**
 * @param {string} customId
 * @returns {{ action: "approve" | "deny"; taskId: string } | null}
 */
export function parseDecisionCustomId(customId) {
  const s = String(customId ?? "").trim();
  const m = s.match(/^hdc:(approve|deny):([A-Za-z0-9][A-Za-z0-9._-]*)$/);
  if (!m) return null;
  return {
    action: /** @type {"approve" | "deny"} */ (m[1]),
    taskId: m[2],
  };
}

/**
 * @param {string} privateRoot
 * @param {{ action: "approve" | "deny"; taskId: string }} decision
 * @returns {{ ok: boolean; status: string; message: string; already?: boolean }}
 */
export function applyDiscordTaskDecision(privateRoot, decision) {
  let current;
  try {
    current = readTask(privateRoot, decision.taskId);
  } catch {
    return {
      ok: false,
      status: "missing",
      message: `Task \`${decision.taskId}\` not found.`,
    };
  }

  const terminal = new Set(["approved", "blocked", "done"]);
  if (terminal.has(current.status)) {
    return {
      ok: true,
      status: current.status,
      already: true,
      message: `Task \`${decision.taskId}\` already **${current.status}** (no change).`,
    };
  }

  if (decision.action === "approve") {
    const result = patchTaskApi(
      privateRoot,
      decision.taskId,
      { status: "approved", needs_decision: false },
      { user: "discord", sessionOnly: false },
    );
    if (!result.ok) {
      return {
        ok: false,
        status: current.status,
        message: `Failed to approve \`${decision.taskId}\`: ${result.error ?? "unknown"}`,
      };
    }
    return {
      ok: true,
      status: "approved",
      message: `Approved task \`${decision.taskId}\` via Discord.`,
    };
  }

  const result = patchTaskApi(
    privateRoot,
    decision.taskId,
    {
      status: "blocked",
      needs_decision: false,
      blocked_reason: "Operator declined via Discord",
    },
    { user: "discord", sessionOnly: false },
  );
  if (!result.ok) {
    return {
      ok: false,
      status: current.status,
      message: `Failed to deny \`${decision.taskId}\`: ${result.error ?? "unknown"}`,
    };
  }
  return {
    ok: true,
    status: "blocked",
    message: `Denied task \`${decision.taskId}\` via Discord.`,
  };
}

/**
 * @param {string} originalContent
 * @param {string} outcomeLine
 */
export function buildUpdatedDecisionContent(originalContent, outcomeLine) {
  const base = String(originalContent ?? "").trim();
  const outcome = String(outcomeLine ?? "").trim();
  if (!base) return outcome;
  if (!outcome) return base;
  return `${base}\n\n_${outcome}_`;
}

/**
 * Handle a verified Discord interaction payload.
 *
 * @param {object} opts
 * @param {unknown} opts.body
 * @param {string} opts.privateRoot
 * @returns {{ status: number; body: Record<string, unknown> }}
 */
export function handleDiscordInteractionPayload(opts) {
  const body = opts.body && typeof opts.body === "object" ? /** @type {Record<string, unknown>} */ (opts.body) : {};
  const type = Number(body.type);

  if (type === DISCORD_INTERACTION_PING) {
    return { status: 200, body: { type: DISCORD_CALLBACK_PONG } };
  }

  if (type !== DISCORD_INTERACTION_MESSAGE_COMPONENT) {
    return {
      status: 200,
      body: {
        type: DISCORD_CALLBACK_UPDATE_MESSAGE,
        data: {
          content: "Unsupported interaction.",
          components: [],
        },
      },
    };
  }

  const data = body.data && typeof body.data === "object" ? /** @type {Record<string, unknown>} */ (body.data) : {};
  const customId = typeof data.custom_id === "string" ? data.custom_id : "";
  const parsed = parseDecisionCustomId(customId);
  if (!parsed) {
    return {
      status: 200,
      body: {
        type: DISCORD_CALLBACK_UPDATE_MESSAGE,
        data: {
          content: "Unknown decision button.",
          components: [],
        },
      },
    };
  }

  const result = applyDiscordTaskDecision(opts.privateRoot, parsed);
  const messageObj =
    body.message && typeof body.message === "object"
      ? /** @type {Record<string, unknown>} */ (body.message)
      : {};
  const original =
    typeof messageObj.content === "string" ? messageObj.content : `Task \`${parsed.taskId}\``;

  return {
    status: 200,
    body: {
      type: DISCORD_CALLBACK_UPDATE_MESSAGE,
      data: {
        content: buildUpdatedDecisionContent(original, result.message),
        components: [],
      },
    },
  };
}
