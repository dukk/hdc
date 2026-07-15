/**
 * Parse manager inbox mail → tasks / decisions / Wazuh IP-block handoff.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  createTask,
  listTasks,
  readTask,
  updateTaskStatus,
} from "./operations-fs.mjs";
import { appendSuggestion } from "./research-topics.mjs";
import { fetchUnseenMessages } from "./imap-client.mjs";
import { notifyDiscordSilent, notifyDiscordDecision } from "./notify-agents-discord.mjs";
import {
  DEFAULT_NEVER_BLOCK_CIDRS,
  isInternalIp,
  isValidIpv4,
} from "hdc/clump/infrastructure/unifi-network/lib/unifi-ip-block.mjs";

export const MAILBOX_STATE_REL = "operations/.mailbox-state.json";

/**
 * @param {string} privateRoot
 */
export function mailboxStatePath(privateRoot) {
  return join(privateRoot, MAILBOX_STATE_REL);
}

/**
 * @param {string} privateRoot
 * @returns {{ processed_message_ids: string[] }}
 */
export function loadMailboxState(privateRoot) {
  const path = mailboxStatePath(privateRoot);
  if (!existsSync(path)) return { processed_message_ids: [] };
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    return {
      processed_message_ids: Array.isArray(raw.processed_message_ids)
        ? raw.processed_message_ids.map(String)
        : [],
    };
  } catch {
    return { processed_message_ids: [] };
  }
}

/**
 * @param {string} privateRoot
 * @param {{ processed_message_ids: string[] }} state
 */
export function saveMailboxState(privateRoot, state) {
  mkdirSync(join(privateRoot, "operations"), { recursive: true });
  const ids = state.processed_message_ids.slice(-500);
  writeFileSync(
    mailboxStatePath(privateRoot),
    `${JSON.stringify({ processed_message_ids: ids }, null, 2)}\n`,
    "utf8",
  );
}

/**
 * @param {string} raw
 */
export function parseMailRaw(raw) {
  const sep = raw.search(/\r?\n\r?\n/);
  const headerText = sep >= 0 ? raw.slice(0, sep) : raw;
  const body = sep >= 0 ? raw.slice(sep).replace(/^\r?\n\r?\n/, "") : "";
  /** @type {Record<string, string>} */
  const headers = {};
  let current = "";
  for (const line of headerText.split(/\r?\n/)) {
    if (/^\s/.test(line) && current) {
      headers[current] = `${headers[current]} ${line.trim()}`;
      continue;
    }
    const i = line.indexOf(":");
    if (i < 0) continue;
    current = line.slice(0, i).trim().toLowerCase();
    headers[current] = line.slice(i + 1).trim();
  }
  const from = headers.from ?? "";
  const subject = headers.subject ?? "";
  const messageId = headers["message-id"] ?? "";
  const authResults = headers["authentication-results"] ?? headers["arc-authentication-results"] ?? "";
  return { headers, from, subject, body, messageId, authResults, raw };
}

/** @param {string} from */
export function extractEmailAddress(from) {
  const m = String(from).match(/<([^>]+)>/);
  if (m) return m[1].trim().toLowerCase();
  const bare = String(from).trim().toLowerCase();
  return bare.includes("@") ? bare : "";
}

/**
 * Require SPF or DKIM pass in Authentication-Results for the From domain.
 * @param {string} authResults
 * @param {string} fromEmail
 */
export function isAuthenticatedFrom(authResults, fromEmail) {
  const domain = fromEmail.includes("@") ? fromEmail.split("@")[1].toLowerCase() : "";
  if (!domain || !authResults) return false;
  const text = authResults.toLowerCase();
  const dkimPass = /dkim\s*=\s*pass/.test(text);
  const spfPass = /spf\s*=\s*pass/.test(text);
  const dmarcPass = /dmarc\s*=\s*pass/.test(text);
  if (!(dkimPass || spfPass || dmarcPass)) return false;
  // Prefer signals that mention the domain, but accept global pass when domain is in header block.
  if (text.includes(domain)) return true;
  return dkimPass || spfPass;
}

/**
 * @param {string} subject
 * @param {string} body
 * @param {string} from
 */
export function classifyMail(subject, body, from) {
  const fromEmail = extractEmailAddress(from);
  const subj = subject.toLowerCase();
  const blob = `${subject}\n${body}`.toLowerCase();

  const isWazuh =
    /wazuh/i.test(from) ||
    /wazuh/i.test(subject) ||
    /ossec/i.test(subject) ||
    /\[wazuh\]/i.test(subject);

  const isResearchSuggestion =
    /^\s*research\s*:/i.test(subject) ||
    /\[research\]/i.test(blob) ||
    /\bhdc research\s*:/i.test(blob);

  const decisionMatch = blob.match(
    /\b(approve|accept|reject|deny)\b[\s:#-]*([a-z0-9][a-z0-9._-]*)/i,
  );
  if (decisionMatch && !isWazuh && !isResearchSuggestion) {
    const action = decisionMatch[1].toLowerCase();
    const taskId = decisionMatch[2];
    const approve = action === "approve" || action === "accept";
    return { kind: /** @type {const} */ ("decision"), fromEmail, taskId, approve };
  }

  if (isWazuh) {
    const level = parseWazuhLevel(subject, body);
    const srcIp = parseWazuhSourceIp(subject, body);
    return { kind: /** @type {const} */ ("wazuh"), fromEmail, level, srcIp, subject };
  }

  if (isResearchSuggestion) {
    const title = subject.replace(/^\s*research\s*:\s*/i, "").trim() || subject.trim();
    return {
      kind: /** @type {const} */ ("research_suggestion"),
      fromEmail,
      subject,
      title,
      body,
    };
  }

  return { kind: /** @type {const} */ ("general"), fromEmail, subject, body };
}

/** @param {string} subject @param {string} body */
export function parseWazuhLevel(subject, body) {
  const m =
    String(subject).match(/\blevel\s*[:=]?\s*(\d+)/i) ||
    String(body).match(/\blevel\s*[:=]?\s*(\d+)/i) ||
    String(subject).match(/\b\(level\s+(\d+)\)/i);
  return m ? Number(m[1]) : null;
}

/** @param {string} subject @param {string} body */
export function parseWazuhSourceIp(subject, body) {
  const blob = `${subject}\n${body}`;
  const labeled =
    blob.match(/\b(?:srcip|source[_ ]?ip|src)\s*[:=]\s*(\d{1,3}(?:\.\d{1,3}){3})/i) ||
    blob.match(/\bfrom\s+(\d{1,3}(?:\.\d{1,3}){3})\b/i);
  if (labeled && isValidIpv4(labeled[1]) && !isInternalIp(labeled[1], DEFAULT_NEVER_BLOCK_CIDRS)) {
    return labeled[1];
  }
  const all = blob.match(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/g) || [];
  for (const ip of all) {
    if (isValidIpv4(ip) && !isInternalIp(ip, DEFAULT_NEVER_BLOCK_CIDRS)) return ip;
  }
  return null;
}

/**
 * @param {string} messageId
 * @param {string} raw
 */
export function stableMailKey(messageId, raw) {
  if (messageId.trim()) return messageId.trim().toLowerCase();
  return `hash:${createHash("sha256").update(raw).digest("hex").slice(0, 24)}`;
}

/**
 * @param {object} opts
 * @param {string} opts.hdcRoot
 * @param {string} opts.privateRoot
 * @param {Record<string, unknown>} opts.mailboxConfig
 * @param {(line: string) => void} [opts.log]
 * @param {string} [opts.password]
 */
export async function processManagerMailbox(opts) {
  const log = opts.log ?? ((line) => process.stderr.write(`${line}\n`));
  const cfg = opts.mailboxConfig ?? {};
  if (cfg.enabled === false) {
    return { ok: true, skipped: true, processed: 0 };
  }

  const host =
    typeof cfg.host === "string" && cfg.host.trim()
      ? cfg.host.trim()
      : "mailcow-a.hdc.dukk.org";
  const port = typeof cfg.port === "number" ? cfg.port : 993;
  const user =
    typeof cfg.user === "string" && cfg.user.trim()
      ? cfg.user.trim()
      : "manager@hdc.dukk.org";
  const password =
    opts.password ||
    String(process.env.HDC_MANAGER_MAILBOX_PASSWORD ?? "").trim() ||
    String(process.env[String(cfg.password_env || "")] ?? "").trim();
  if (!password) {
    log("[mailbox] no IMAP password (HDC_MANAGER_MAILBOX_PASSWORD); skip");
    return { ok: true, skipped: true, processed: 0, reason: "no_password" };
  }

  /** @type {string[]} */
  const trusted = Array.isArray(cfg.trusted_senders)
    ? cfg.trusted_senders.map((s) => String(s).toLowerCase())
    : ["dukk@dukk.org"];
  const alertLevelMin =
    typeof cfg.wazuh_alert_level_min === "number" ? cfg.wazuh_alert_level_min : 10;
  const blockDays = typeof cfg.block_days === "number" ? cfg.block_days : 30;

  const state = loadMailboxState(opts.privateRoot);
  const processed = new Set(state.processed_message_ids);

  let messages;
  try {
    const folders = Array.isArray(cfg.folders) && cfg.folders.length
      ? cfg.folders.map((f) => String(f).trim()).filter(Boolean)
      : ["INBOX", "Junk"];
    messages = await fetchUnseenMessages({
      host,
      port,
      user,
      password,
      // Mailcow LAN TLS is typically self-signed; opt in to strict verify.
      rejectUnauthorized: cfg.tls_reject_unauthorized === true,
      mailboxes: folders,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(`[mailbox] IMAP fetch failed: ${msg}`);
    return { ok: false, error: msg, processed: 0 };
  }

  let count = 0;
  for (const msg of messages) {
    const parsed = parseMailRaw(msg.raw);
    const key = stableMailKey(parsed.messageId, msg.raw);
    if (processed.has(key)) continue;

    notifyDiscordSilent(
      opts.hdcRoot,
      opts.privateRoot,
      "HDC mail received",
      `From: ${parsed.from}\nSubject: ${parsed.subject}\nUID: ${msg.uid}`,
    );

    const kind = classifyMail(parsed.subject, parsed.body, parsed.from);
    if (kind.kind === "decision") {
      await handleDecision({
        ...opts,
        kind,
        parsed,
        trusted,
        log,
      });
    } else if (kind.kind === "wazuh") {
      handleWazuh({
        privateRoot: opts.privateRoot,
        hdcRoot: opts.hdcRoot,
        kind,
        alertLevelMin,
        blockDays,
        log,
      });
    } else if (kind.kind === "research_suggestion") {
      handleResearchSuggestion({
        privateRoot: opts.privateRoot,
        hdcRoot: opts.hdcRoot,
        kind,
        messageKey: key,
        log,
      });
    } else {
      handleGeneral({
        privateRoot: opts.privateRoot,
        hdcRoot: opts.hdcRoot,
        kind,
        messageKey: key,
        log,
      });
    }

    processed.add(key);
    count += 1;
  }

  saveMailboxState(opts.privateRoot, { processed_message_ids: [...processed] });
  log(`[mailbox] processed ${count} new message(s)`);
  return { ok: true, processed: count };
}

/**
 * @param {object} opts
 */
async function handleDecision(opts) {
  const { kind, parsed, trusted, log, hdcRoot, privateRoot } = opts;
  const fromEmail = kind.fromEmail;
  if (!trusted.includes(fromEmail)) {
    log(`[mailbox] decision ignored; untrusted from ${fromEmail}`);
    return;
  }
  const authOk = isAuthenticatedFrom(parsed.authResults, fromEmail);
  if (!authOk) {
    log(`[mailbox] SPOOF alert: trusted From ${fromEmail} without SPF/DKIM/DMARC pass`);
    notifyDiscordDecision(
      hdcRoot,
      privateRoot,
      "HDC email spoof alert",
      `Claimed From ${fromEmail} sent decision for task ${kind.taskId} but Authentication-Results failed.\nSubject: ${parsed.subject}`,
      kind.taskId,
    );
    return;
  }
  try {
    readTask(privateRoot, kind.taskId);
  } catch {
    log(`[mailbox] decision task not found: ${kind.taskId}`);
    return;
  }
  if (kind.approve) {
    updateTaskStatus(privateRoot, kind.taskId, { status: "approved", needs_decision: false });
    notifyDiscordSilent(
      hdcRoot,
      privateRoot,
      "HDC task approved (email)",
      `Task ${kind.taskId} approved by ${fromEmail}`,
    );
  } else {
    updateTaskStatus(privateRoot, kind.taskId, {
      status: "blocked",
      needs_decision: false,
      blocked_reason: `Rejected by email from ${fromEmail}`,
    });
    notifyDiscordSilent(
      hdcRoot,
      privateRoot,
      "HDC task rejected (email)",
      `Task ${kind.taskId} rejected by ${fromEmail}`,
    );
  }
}

/**
 * @param {object} opts
 */
function handleWazuh(opts) {
  const { kind, alertLevelMin, blockDays, privateRoot, hdcRoot, log } = opts;
  const level = kind.level ?? 0;
  if (level < alertLevelMin) {
    log(`[mailbox] wazuh level ${level} below ${alertLevelMin}; skip block`);
    createTask(privateRoot, {
      id: `wazuh-alert-${Date.now()}`,
      role: "hdc-security-expert",
      priority: level >= 7 ? "high" : "medium",
      status: "pending",
      title: `Wazuh alert level ${level}: ${kind.subject}`.slice(0, 120),
      body: `Inbound Wazuh mail (level ${level}). Source IP: ${kind.srcIp ?? "(unknown)"}.\n`,
      evidence: ["manager mailbox"],
    });
    notifyDiscordSilent(hdcRoot, privateRoot, "HDC task created", `Wazuh alert task (level ${level})`);
    return;
  }
  const ip = kind.srcIp;
  if (!ip || isInternalIp(ip, DEFAULT_NEVER_BLOCK_CIDRS)) {
    log(`[mailbox] wazuh level ${level} but no external src IP (got ${ip})`);
    createTask(privateRoot, {
      id: `wazuh-l${level}-${Date.now()}`,
      role: "hdc-security-expert",
      priority: "critical",
      status: "pending",
      needs_decision: true,
      title: `Wazuh level ${level}+ without blockable IP`,
      body: `Could not extract external source IP from alert.\nSubject: ${kind.subject}\n`,
    });
    return;
  }

  const id = `wazuh-block-${ip.replace(/\./g, "-")}`;
  const existing = listTasks(privateRoot, { includeDone: true }).find((t) => t.id === id);
  const cmd = `hdc run infrastructure unifi-network maintain -- --block ${ip} --days ${blockDays} --reason wazuh-level-${level}`;
  if (existing && existing.status !== "done" && existing.status !== "blocked") {
    updateTaskStatus(privateRoot, id, {
      status: "approved",
      priority: "critical",
      updated_at: new Date().toISOString(),
    });
    notifyDiscordSilent(hdcRoot, privateRoot, "HDC task updated", `Refresh block task ${id}`);
    return;
  }
  createTask(privateRoot, {
    id,
    role: "hdc-security-expert",
    priority: "critical",
    status: "approved",
    needs_decision: false,
    title: `Block ${ip} 30d (Wazuh level ${level}+)`,
    suggested_commands: [cmd],
    evidence: ["manager mailbox", "wazuh email"],
    body:
      `Auto-created from Wazuh alert (level ${level}).\n\n` +
      `Block external source IP in UniFi for ${blockDays} days. Do not block internal CIDRs.\n\n` +
      `Suggested:\n\`\`\`\n${cmd}\n\`\`\`\n`,
  });
  notifyDiscordSilent(
    hdcRoot,
    privateRoot,
    "HDC task created",
    `Wazuh→UniFi block task ${id} assigned to hdc-security-expert`,
  );
  log(`[mailbox] created/approved block task ${id}`);
}

/**
 * @param {object} opts
 */
function handleResearchSuggestion(opts) {
  const { kind, messageKey, privateRoot, hdcRoot, log } = opts;
  const title = kind.title || kind.subject || "Research suggestion";
  const urlMatch = String(kind.body).match(/https?:\/\/[^\s<>"']+/i);
  const url = urlMatch ? urlMatch[0] : "";

  appendSuggestion(privateRoot, {
    title,
    body: String(kind.body).trim(),
    url,
    source: `email:${kind.fromEmail || "unknown"}`,
  });

  const slug = createHash("sha256").update(messageKey).digest("hex").slice(0, 10);
  const id = `research-suggest-${slug}`;
  const existing = listTasks(privateRoot, { includeDone: true }).find((t) => t.id === id);
  if (existing) {
    updateTaskStatus(privateRoot, id, { status: existing.status });
    notifyDiscordSilent(hdcRoot, privateRoot, "HDC task updated", `Research suggestion ${id} touched`);
    log(`[mailbox] research suggestion task exists: ${id}`);
    return;
  }

  createTask(privateRoot, {
    id,
    role: "hdc-manager",
    priority: "low",
    status: "pending",
    title: `Triage research suggestion: ${title}`.slice(0, 120),
    evidence: ["manager mailbox", messageKey, "operations/research/suggestions.md"],
    body:
      `From: ${kind.fromEmail}\n\n` +
      `Research suggestion received by email. Review operations/research/suggestions.md ` +
      `and promote to operations/research/topics/<id>.md with status queued when ready.\n\n` +
      `${String(kind.body).slice(0, 4000)}\n`,
  });
  notifyDiscordSilent(hdcRoot, privateRoot, "HDC task created", `Research suggestion: ${id}`);
  log(`[mailbox] created research triage task ${id}`);
}

/**
 * @param {object} opts
 */
function handleGeneral(opts) {
  const { kind, messageKey, privateRoot, hdcRoot } = opts;
  const slug = createHash("sha256").update(messageKey).digest("hex").slice(0, 10);
  const id = `mail-${slug}`;
  const existing = listTasks(privateRoot, { includeDone: true }).find((t) => t.id === id);
  if (existing) {
    updateTaskStatus(privateRoot, id, { status: existing.status });
    notifyDiscordSilent(hdcRoot, privateRoot, "HDC task updated", `Mail task ${id} touched`);
    return;
  }
  createTask(privateRoot, {
    id,
    role: "hdc-manager",
    priority: "medium",
    status: "pending",
    title: (kind.subject || "Email to manager").slice(0, 120),
    evidence: ["manager mailbox", messageKey],
    body: `From: ${kind.fromEmail}\n\n${String(kind.body).slice(0, 4000)}\n`,
  });
  notifyDiscordSilent(hdcRoot, privateRoot, "HDC task created", `From mail: ${id}`);
}
