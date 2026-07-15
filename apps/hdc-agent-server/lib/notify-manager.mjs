/**
 * Manager notification router (per-event channel fan-out).
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import {
  loadNotificationsConfigFromFiles,
  MANAGER_ROUTE_KEYS,
} from "../../hdc-cli/lib/notifications-config.mjs";

export { MANAGER_ROUTE_KEYS };

export const ROUTE_NEEDS_DECISION = "needs_decision";
export const ROUTE_MAILBOX_RECEIVED = "mailbox_received";
export const ROUTE_MAILBOX_SPOOF = "mailbox_spoof";
export const ROUTE_MAILBOX_TASK_UPDATE = "mailbox_task_update";

/**
 * @param {string} hdcRoot
 * @param {string} privateRoot
 */
export function loadNotificationsConfig(hdcRoot, privateRoot) {
  return loadNotificationsConfigFromFiles(hdcRoot, privateRoot);
}

/**
 * @param {string} hdcRoot
 * @param {string} privateRoot
 * @param {import("../../hdc-cli/lib/notifications-config.mjs").ManagerRouteKey} routeKey
 * @param {{ title: string, message: string, taskId?: string, decision?: boolean, silent?: boolean }} opts
 */
export function notifyManagerEvent(hdcRoot, privateRoot, routeKey, opts) {
  const script = join(hdcRoot, "apps", "hdc-cli", "lib", "notify.mjs");
  if (!existsSync(script)) {
    return { ok: false, error: "notify.mjs missing" };
  }
  /** @type {string[]} */
  const args = [
    script,
    "--route",
    routeKey,
    "--title",
    opts.title,
    "--message",
    opts.message,
  ];
  if (opts.silent !== false && !opts.decision) {
    args.push("--silent");
  }
  const tid = String(opts.taskId ?? "").trim();
  if (opts.decision && tid) {
    args.push("--decision", "--task-id", tid);
  }
  const r = spawnSync(process.execPath, args, {
    cwd: hdcRoot,
    env: { ...process.env, HDC_PRIVATE_ROOT: privateRoot || process.env.HDC_PRIVATE_ROOT },
    encoding: "utf8",
    timeout: 60_000,
  });
  return {
    ok: r.status === 0,
    status: r.status,
    stderr: r.stderr?.slice(0, 500),
    stdout: r.stdout?.slice(0, 500),
  };
}

/**
 * @param {string} hdcRoot
 * @param {string} privateRoot
 * @param {string} title
 * @param {string} message
 */
export function notifyManagerSilent(hdcRoot, privateRoot, title, message) {
  return notifyManagerEvent(hdcRoot, privateRoot, ROUTE_MAILBOX_TASK_UPDATE, {
    title,
    message,
    silent: true,
  });
}

/**
 * @param {string} hdcRoot
 * @param {string} privateRoot
 * @param {string} title
 * @param {string} message
 * @param {string} [taskId]
 */
export function notifyManagerDecision(hdcRoot, privateRoot, title, message, taskId) {
  return notifyManagerEvent(hdcRoot, privateRoot, ROUTE_NEEDS_DECISION, {
    title,
    message,
    silent: false,
    decision: true,
    taskId,
  });
}
