import { formatUsd } from "./aws-cost-estimate.mjs";

/** @typedef {import("./aws-cost-estimate.mjs").CostEstimate} CostEstimate */

/**
 * @typedef {object} CostReportMeta
 * @property {CostEstimate | null} estimate
 * @property {boolean} [confirmed]
 * @property {boolean} [skipped_confirm]
 * @property {boolean} [dry_run_only]
 */

/**
 * Attach cost estimate fields to a stdout payload for operation reports.
 * @param {Record<string, unknown>} payload
 * @param {CostReportMeta} meta
 */
export function attachCostReportToPayload(payload, meta) {
  if (meta.estimate) payload.cost_estimate = meta.estimate;
  if (meta.confirmed !== undefined) payload.cost_confirmed = meta.confirmed;
  if (meta.skipped_confirm !== undefined) payload.cost_confirm_skipped = meta.skipped_confirm;
  if (meta.dry_run_only !== undefined) payload.cost_dry_run_only = meta.dry_run_only;
  return payload;
}

/**
 * @param {Record<string, unknown> | null | undefined} payload
 * @returns {CostReportMeta}
 */
export function costMetaFromPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return { estimate: null };
  }
  const estimate = /** @type {CostEstimate | null} */ (
    payload.cost_estimate && typeof payload.cost_estimate === "object" ? payload.cost_estimate : null
  );
  return {
    estimate,
    confirmed: payload.cost_confirmed === true,
    skipped_confirm: payload.cost_confirm_skipped === true,
    dry_run_only: payload.cost_dry_run_only === true,
  };
}

/**
 * @param {CostReportMeta} meta
 * @returns {string[]}
 */
export function renderCostEstimateMarkdown(meta) {
  const { estimate } = meta;
  if (!estimate) return [];

  /** @type {string[]} */
  const lines = ["## Cost estimate", ""];
  if (!estimate.lines.length) {
    lines.push("_No billable resources in this operation._", "");
    return lines;
  }

  lines.push("| Resource | Service | Monthly (USD) | Notes |");
  lines.push("| --- | --- | ---: | --- |");
  for (const line of estimate.lines) {
    const notes = line.notes ?? "";
    lines.push(
      `| \`${line.resource_id}\` | ${line.service} | ${formatUsd(line.monthly_usd)} | ${notes} |`,
    );
  }
  lines.push("");
  lines.push(`**Total:** ${formatUsd(estimate.total_monthly_usd)}/month (${estimate.currency})`);
  lines.push("");

  if (meta.confirmed) lines.push("- Operator confirmed cost before apply.");
  if (meta.skipped_confirm) lines.push("- Cost confirmation skipped (`--yes`, `--skip-cost-confirm`, or config).");
  if (meta.dry_run_only) lines.push("- Dry-run only; no resources applied.");

  if (estimate.warnings?.length) {
    lines.push("", "**Warnings:**");
    for (const w of estimate.warnings) lines.push(`- ${w}`);
  }

  lines.push("", `_${estimate.disclaimer}_`, "");
  return lines;
}

/**
 * Factory for operation-report extraSections.
 * @param {(ctx: import("./operation-report.mjs").OperationReportContext) => CostReportMeta} [metaFromCtx]
 * @returns {(ctx: import("./operation-report.mjs").OperationReportContext) => string[]}
 */
export function costReportExtraSections(metaFromCtx) {
  return (ctx) => {
    const meta = metaFromCtx
      ? metaFromCtx(ctx)
      : costMetaFromPayload(
          ctx.stdoutPayload && typeof ctx.stdoutPayload === "object"
            ? /** @type {Record<string, unknown>} */ (ctx.stdoutPayload)
            : null,
        );
    return renderCostEstimateMarkdown(meta);
  };
}
