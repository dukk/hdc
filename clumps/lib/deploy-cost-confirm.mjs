import { createInterface } from "node:readline/promises";
import { stdin, stderr } from "node:process";

import { flagGet } from "./parse-argv-flags.mjs";
import { formatUsd, logCostEstimate } from "./aws-cost-estimate.mjs";

/** @typedef {import("./aws-cost-estimate.mjs").CostEstimate} CostEstimate */

/**
 * @param {Record<string, string>} flags
 */
export function deployCostConfirmed(flags) {
  return flagGet(flags, "yes", "y") !== undefined;
}

/**
 * @param {Record<string, string>} flags
 */
export function deployCostDryRun(flags) {
  return flagGet(flags, "dry-run", "dry_run") !== undefined;
}

/**
 * @param {Record<string, string>} flags
 */
export function skipCostConfirm(flags) {
  return flagGet(flags, "skip-cost-confirm", "skip_cost_confirm") !== undefined;
}

/**
 * @param {Record<string, string>} flags
 */
export function acceptUnknownCost(flags) {
  return flagGet(flags, "accept-unknown-cost", "accept_unknown_cost") !== undefined;
}

/**
 * @param {CostEstimate} estimate
 * @param {Record<string, string>} flags
 */
export function validateCostEstimateForDeploy(estimate, flags) {
  if (estimate.lines.length > 0) return;
  if (acceptUnknownCost(flags) || deployCostConfirmed(flags) || skipCostConfirm(flags)) return;
  throw new Error(
    "Cost estimate unavailable; pass --accept-unknown-cost or --yes to proceed without a price estimate",
  );
}

/**
 * @param {object} opts
 * @param {CostEstimate} opts.estimate
 * @param {Record<string, string>} opts.flags
 * @param {boolean} [opts.confirmBeforeDeploy]
 * @param {(line: string) => void} [opts.log]
 * @param {boolean} [opts.hasCreates]
 * @param {NodeJS.ReadableStream} [opts.input]
 * @param {NodeJS.WritableStream} [opts.output]
 * @returns {Promise<{ proceed: boolean; confirmed: boolean; skipped: boolean }>}
 */
export async function confirmDeployCost(opts) {
  const log = opts.log ?? ((line) => stderr.write(`${line}\n`));
  const input = opts.input ?? stdin;
  const output = opts.output ?? stderr;
  const dryRun = deployCostDryRun(opts.flags);
  const hasCreates = opts.hasCreates !== false;

  validateCostEstimateForDeploy(opts.estimate, opts.flags);

  if (!hasCreates) {
    return { proceed: !dryRun, confirmed: true, skipped: true };
  }

  logCostEstimate(opts.estimate, log);

  if (dryRun) {
    log("dry-run: skipping apply after cost estimate");
    return { proceed: false, confirmed: false, skipped: false };
  }

  if (skipCostConfirm(opts.flags)) {
    log("warning: --skip-cost-confirm set; proceeding without prompt");
    return { proceed: true, confirmed: false, skipped: true };
  }

  if (opts.confirmBeforeDeploy === false) {
    log("cost.confirm_before_deploy is false; proceeding without prompt");
    return { proceed: true, confirmed: false, skipped: true };
  }

  if (deployCostConfirmed(opts.flags)) {
    return { proceed: true, confirmed: true, skipped: false };
  }

  if (!input.isTTY) {
    throw new Error(
      `Non-interactive deploy with billable creates requires --yes (estimated ${formatUsd(opts.estimate.total_monthly_usd)}/month)`,
    );
  }

  const q = `Proceed with estimated ${formatUsd(opts.estimate.total_monthly_usd)}/month? [y/N] `;
  const rl = createInterface({ input, output });
  try {
    const raw = (await rl.question(q)).trim().toLowerCase();
    const ok = raw === "y" || raw === "yes";
    if (!ok) log("Aborted by operator.");
    return { proceed: ok, confirmed: ok, skipped: false };
  } finally {
    rl.close();
  }
}
