/**
 * Shared cost estimate types and markdown formatting for Azure/GCP deploy reports.
 * Converts to {@link import("./aws-cost-estimate.mjs").CostEstimate} for deploy-cost-confirm.
 */
import { buildCostEstimate } from "./aws-cost-estimate.mjs";

/** @typedef {{ label: string; quantity?: number; unit?: string; monthly_usd: number; hourly_usd?: number; notes?: string }} CostLineItem */

/**
 * @typedef {object} CostEstimate
 * @property {number | null} monthly_usd
 * @property {number | null} hourly_usd
 * @property {string} currency
 * @property {CostLineItem[]} line_items
 * @property {string} [disclaimer]
 * @property {string} [source]
 * @property {boolean} [unknown]
 */

export const DEFAULT_COST_DISCLAIMER =
  "Estimate only; excludes egress, snapshots, reserved-instance discounts, and tax.";

/**
 * @param {CostLineItem[]} items
 * @returns {{ monthly_usd: number; hourly_usd: number }}
 */
export function sumLineItems(items) {
  let monthly = 0;
  let hourly = 0;
  for (const item of items) {
    monthly += Number(item.monthly_usd) || 0;
    if (typeof item.hourly_usd === "number") hourly += item.hourly_usd;
  }
  return { monthly_usd: monthly, hourly_usd: hourly };
}

/**
 * @param {number | null | undefined} value
 * @param {string} [currency]
 */
export function formatUsd(value, currency = "USD") {
  if (value === null || value === undefined || Number.isNaN(value)) return "unknown";
  return `${currency} ${value.toFixed(2)}`;
}

/**
 * @param {CostEstimate | null | undefined} estimate
 * @returns {string[]}
 */
export function formatCostEstimateMarkdown(estimate) {
  if (!estimate) return ["_No cost estimate available._"];
  /** @type {string[]} */
  const lines = [];
  const monthly =
    estimate.monthly_usd === null || estimate.monthly_usd === undefined
      ? "unknown"
      : formatUsd(estimate.monthly_usd, estimate.currency);
  const hourly =
    estimate.hourly_usd === null || estimate.hourly_usd === undefined
      ? null
      : formatUsd(estimate.hourly_usd, estimate.currency);

  lines.push(`**Estimated monthly:** ~${monthly}`);
  if (hourly) lines.push(`**Estimated hourly:** ~${hourly}`);
  if (estimate.source) lines.push(`**Pricing source:** ${estimate.source}`);
  if (estimate.unknown) lines.push("**Status:** pricing unavailable (estimate unknown)");
  if (estimate.disclaimer) lines.push(`_${estimate.disclaimer}_`);

  if (estimate.line_items?.length) {
    lines.push("");
    lines.push("| Component | Qty | Unit | Monthly | Hourly | Notes |");
    lines.push("| --- | ---: | --- | ---: | ---: | --- |");
    for (const item of estimate.line_items) {
      const qty = item.quantity ?? "";
      const unit = item.unit ?? "";
      const mo =
        item.monthly_usd === null || item.monthly_usd === undefined
          ? "unknown"
          : formatUsd(item.monthly_usd, estimate.currency);
      const hr =
        item.hourly_usd === null || item.hourly_usd === undefined
          ? ""
          : formatUsd(item.hourly_usd, estimate.currency);
      lines.push(
        `| ${item.label} | ${qty} | ${unit} | ${mo} | ${hr} | ${item.notes ?? ""} |`,
      );
    }
  }
  return lines;
}

/**
 * @param {CostEstimate} estimate
 * @param {(line: string) => void} log
 */
export function logCostEstimate(estimate, log) {
  log("Cost estimate:");
  for (const line of formatCostEstimateMarkdown(estimate)) {
    if (!line.startsWith("|") && line !== "") log(`  ${line.replace(/\*\*/g, "")}`);
  }
}

/**
 * @param {CostEstimate | null | undefined} estimate
 */
export function isUnknownCostEstimate(estimate) {
  if (!estimate) return true;
  if (estimate.unknown) return true;
  return estimate.monthly_usd === null || estimate.monthly_usd === undefined;
}

/**
 * @param {CostEstimate | null | undefined} estimate
 * @param {string} [resourceId]
 * @returns {import("./aws-cost-estimate.mjs").CostEstimate}
 */
export function toAwsCostEstimate(estimate, resourceId = "deployment") {
  if (!estimate || isUnknownCostEstimate(estimate)) {
    return buildCostEstimate([], {
      disclaimer: estimate?.disclaimer,
      warnings: ["Cost estimate unavailable from pricing API"],
    });
  }
  const lines = (estimate.line_items ?? []).map((item) => ({
    resource_id: resourceId,
    service: item.label,
    monthly_usd: Number(item.monthly_usd) || 0,
    notes: item.notes,
  }));
  return buildCostEstimate(lines, { disclaimer: estimate.disclaimer });
}
