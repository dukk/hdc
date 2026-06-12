/**
 * Shared cost estimate types and formatting for AWS deploy gates.
 */

/** @typedef {{ resource_id: string; service: string; sku?: string; monthly_usd: number; notes?: string }} CostEstimateLine */

/**
 * @typedef {object} CostEstimate
 * @property {CostEstimateLine[]} lines
 * @property {number} total_monthly_usd
 * @property {string} currency
 * @property {string} disclaimer
 * @property {string[]} [warnings]
 */

export const DEFAULT_COST_DISCLAIMER =
  "Estimates use on-demand public list prices in USD. Excludes data transfer, tax, Savings Plans, Reserved Instances, free tier, and partial-month proration.";

/**
 * @param {CostEstimateLine[]} lines
 * @param {object} [opts]
 * @param {string} [opts.disclaimer]
 * @param {string[]} [opts.warnings]
 * @returns {CostEstimate}
 */
export function buildCostEstimate(lines, opts = {}) {
  const filtered = lines.filter((l) => Number.isFinite(l.monthly_usd) && l.monthly_usd >= 0);
  const total = filtered.reduce((sum, l) => sum + l.monthly_usd, 0);
  return {
    lines: filtered,
    total_monthly_usd: Math.round(total * 100) / 100,
    currency: "USD",
    disclaimer: opts.disclaimer ?? DEFAULT_COST_DISCLAIMER,
    warnings: opts.warnings ?? [],
  };
}

/**
 * @param {number} value
 * @param {number} [digits]
 */
export function formatUsd(value, digits = 2) {
  if (!Number.isFinite(value)) return "—";
  return `$${value.toFixed(digits)}`;
}

/**
 * @param {CostEstimate} estimate
 * @returns {string[]}
 */
export function formatCostEstimateTableLines(estimate) {
  /** @type {string[]} */
  const lines = [];
  lines.push("Cost estimate (monthly, USD):");
  if (!estimate.lines.length) {
    lines.push("  (no billable creates in plan)");
    return lines;
  }
  const idWidth = Math.max(10, ...estimate.lines.map((l) => l.resource_id.length));
  const svcWidth = Math.max(7, ...estimate.lines.map((l) => l.service.length));
  lines.push(
    `  ${"Resource".padEnd(idWidth)}  ${"Service".padEnd(svcWidth)}  Monthly`,
  );
  for (const line of estimate.lines) {
    const notes = line.notes ? ` (${line.notes})` : "";
    lines.push(
      `  ${line.resource_id.padEnd(idWidth)}  ${line.service.padEnd(svcWidth)}  ${formatUsd(line.monthly_usd)}${notes}`,
    );
  }
  lines.push(`  Total: ${formatUsd(estimate.total_monthly_usd)}/month`);
  if (estimate.warnings?.length) {
    for (const w of estimate.warnings) lines.push(`  warning: ${w}`);
  }
  return lines;
}

/**
 * @param {CostEstimate | null | undefined} a
 * @param {CostEstimate | null | undefined} b
 */
export function mergeCostEstimates(a, b) {
  const lines = [...(a?.lines ?? []), ...(b?.lines ?? [])];
  const warnings = [...(a?.warnings ?? []), ...(b?.warnings ?? [])];
  return buildCostEstimate(lines, {
    disclaimer: a?.disclaimer ?? b?.disclaimer,
    warnings: [...new Set(warnings)],
  });
}

/**
 * @param {CostEstimate} estimate
 * @param {(line: string) => void} log
 */
export function logCostEstimate(estimate, log) {
  for (const line of formatCostEstimateTableLines(estimate)) {
    log(line);
  }
  log(estimate.disclaimer);
}
