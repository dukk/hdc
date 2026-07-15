import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { spawnSync } from "node:child_process";

import { markdownToHtmlEmail } from "./markdown-to-html.mjs";
import { loadMailRelayAppSettings } from "./mail-relay-settings.mjs";

/**
 * Build multipart/alternative MIME message (plain markdown + HTML).
 *
 * @param {object} opts
 * @param {string} opts.to
 * @param {string} opts.from
 * @param {string} opts.subject
 * @param {string} opts.markdown
 * @returns {string}
 */
export function buildReportMimeMessage(opts) {
  const to = String(opts.to ?? "").trim();
  const from = String(opts.from ?? "").trim();
  const subject = String(opts.subject ?? "").trim() || "HDC report";
  const markdown = String(opts.markdown ?? "");
  if (!to) throw new Error("report email: recipient (to) required");
  if (!from) throw new Error("report email: sender (from) required");

  const boundary = `hdc-report-${Date.now().toString(36)}`;
  const html = markdownToHtmlEmail(markdown, { title: subject });

  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    markdown,
    "",
    `--${boundary}`,
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    html,
    "",
    `--${boundary}--`,
    "",
  ];
  return lines.join("\r\n");
}

/**
 * Send a markdown report file via local sendmail (postfix satellite on guest).
 *
 * @param {object} opts
 * @param {string} opts.to
 * @param {string} [opts.from]
 * @param {string} opts.subject
 * @param {string} opts.markdownPath
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {typeof spawnSync} [opts.spawnSyncFn]
 * @returns {{ ok: boolean; message: string }}
 */
export function sendReportEmail(opts) {
  const markdownPath = String(opts.markdownPath ?? "").trim();
  if (!markdownPath) {
    return { ok: false, message: "markdownPath required" };
  }

  const defaults = loadMailRelayAppSettings({ env: opts.env });
  const from =
    typeof opts.from === "string" && opts.from.trim() ? opts.from.trim() : defaults.from;
  const to = String(opts.to ?? "").trim();
  const subject = String(opts.subject ?? "").trim() || `HDC report: ${basename(markdownPath)}`;

  let markdown;
  try {
    markdown = readFileSync(markdownPath, "utf8");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `read report failed: ${msg}` };
  }

  const mime = buildReportMimeMessage({ to, from, subject, markdown });
  const spawnFn = opts.spawnSyncFn ?? spawnSync;
  const r = spawnFn("sendmail", ["-t", "-oi"], {
    input: mime,
    encoding: "utf8",
    env: opts.env ?? process.env,
  });
  if (r.status !== 0) {
    const detail = `${r.stderr ?? ""}${r.stdout ?? ""}`.trim() || `exit ${r.status}`;
    return { ok: false, message: `sendmail failed: ${detail}` };
  }
  return { ok: true, message: `sent to ${to}` };
}

/**
 * Send a plain-text/markdown notification email via local sendmail.
 *
 * @param {object} opts
 * @param {string} opts.to
 * @param {string} [opts.from]
 * @param {string} opts.subject
 * @param {string} opts.markdown
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {typeof spawnSync} [opts.spawnSyncFn]
 * @returns {{ ok: boolean; message: string }}
 */
export function sendPlainEmail(opts) {
  const defaults = loadMailRelayAppSettings({ env: opts.env });
  const from =
    typeof opts.from === "string" && opts.from.trim() ? opts.from.trim() : defaults.from;
  const to = String(opts.to ?? "").trim();
  const subject = String(opts.subject ?? "").trim() || "HDC notification";
  const markdown = String(opts.markdown ?? "");
  if (!to) return { ok: false, message: "recipient (to) required" };
  if (!from) return { ok: false, message: "sender (from) required" };

  let mime;
  try {
    mime = buildReportMimeMessage({ to, from, subject, markdown });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: msg };
  }

  const spawnFn = opts.spawnSyncFn ?? spawnSync;
  const r = spawnFn("sendmail", ["-t", "-oi"], {
    input: mime,
    encoding: "utf8",
    env: opts.env ?? process.env,
  });
  if (r.status !== 0) {
    const detail = `${r.stderr ?? ""}${r.stdout ?? ""}`.trim() || `exit ${r.status}`;
    return { ok: false, message: `sendmail failed: ${detail}` };
  }
  return { ok: true, message: `sent to ${to}` };
}

/**
 * Parse last operation report path from hdc stderr output.
 *
 * @param {string} stderr
 * @returns {string | null}
 */
export function parseReportPathFromStderr(stderr) {
  const lines = String(stderr ?? "").split(/\r?\n/);
  /** @type {string | null} */
  let last = null;
  for (const line of lines) {
    const m = line.match(/\breport\s+(\S+)\s*$/);
    if (m) last = m[1];
  }
  return last;
}
