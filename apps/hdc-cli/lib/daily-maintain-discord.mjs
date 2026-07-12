import { redactIpsFromText } from "./ops-discord-notify.mjs";

/**
 * @typedef {import("./daily-maintain.mjs").DailyStepResult} DailyStepResult
 */

/**
 * @param {{ exitCode: number; results: DailyStepResult[]; dryRun?: boolean }} ctx
 * @returns {{ title: string; message: string }}
 */
export function buildDailyMaintainDiscordSummary(ctx) {
  const ok = ctx.exitCode === 0;
  const drySuffix = ctx.dryRun ? " (dry-run)" : "";
  const title = `HDC daily maintain — ${ok ? "OK" : "FAILED"}${drySuffix}`;

  const ran = ctx.results.filter((r) => r.status !== "skipped");
  const failed = ran.filter((r) => r.ok === false);
  const okCount = ran.filter((r) => r.ok === true).length;

  /** @type {string[]} */
  const parts = [];
  if (ran.length) {
    parts.push(`${okCount}/${ran.length} steps ok`);
  }
  if (failed.length) {
    const names = failed
      .slice(0, 5)
      .map((r) => r.key)
      .filter(Boolean);
    parts.push(`${failed.length} failed${names.length ? `: ${names.join(", ")}` : ""}`);
    const err = failed.find((r) => typeof r.error === "string" && r.error.trim())?.error;
    if (err) {
      parts.push(redactIpsFromText(String(err).trim().slice(0, 200)));
    }
  }
  const skipped = ctx.results.filter((r) => r.status === "skipped").length;
  if (skipped) {
    parts.push(`${skipped} skipped`);
  }

  const message = redactIpsFromText(parts.filter(Boolean).join(" · ") || "completed");
  return { title, message };
}
