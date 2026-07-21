/**
 * Shared Approve/Deny task status updates for Discord/Slack interactions.
 */
import { patchTaskApi, readTask } from "./tasks.mjs";
import { triggerApprovedTaskDispatch } from "./manager-dispatch-client.mjs";

/**
 * @param {string} customId
 * @returns {{ action: "approve" | "deny"; taskId: string } | null}
 */
export function parseDecisionActionId(customId) {
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
 * @param {{ user?: string; denyReason?: string }} [opts]
 * @returns {{ ok: boolean; status: string; message: string; already?: boolean }}
 */
export async function applyTaskDecision(privateRoot, decision, opts = {}) {
  const user = String(opts.user ?? "operator").trim() || "operator";
  const viaLabel =
    String(opts.viaLabel ?? "").trim() ||
    (user === "discord" ? "Discord" : user === "slack" ? "Slack" : user);
  const denyReason =
    String(opts.denyReason ?? "").trim() || `Operator declined via ${viaLabel}`;

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
      { user, sessionOnly: false },
    );
    if (!result.ok) {
      return {
        ok: false,
        status: current.status,
        message: `Failed to approve \`${decision.taskId}\`: ${result.error ?? "unknown"}`,
      };
    }
    const dispatch = await triggerApprovedTaskDispatch(decision.taskId);
    const dispatchNote =
      dispatch.ok && dispatch.dispatched !== false
        ? " Execution dispatched."
        : dispatch.skipped
          ? ""
          : dispatch.ok && dispatch.enqueued
            ? " Manager agent enqueued."
            : dispatch.ok
              ? " Execution dispatched."
              : ` Dispatch pending (${dispatch.message ?? "manager unavailable"}).`;
    return {
      ok: true,
      status: "approved",
      message: `Approved task \`${decision.taskId}\` via ${viaLabel}.${dispatchNote}`,
      dispatch,
    };
  }

  const result = patchTaskApi(
    privateRoot,
    decision.taskId,
    {
      status: "blocked",
      needs_decision: false,
      blocked_reason: denyReason,
    },
    { user, sessionOnly: false },
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
    message: `Denied task \`${decision.taskId}\` via ${viaLabel}.`,
  };
}
