import { describe, expect, it } from "vitest";

import {
  formatCostEstimateMarkdown,
  formatUsd,
  isUnknownCostEstimate,
  sumLineItems,
} from "./cloud-cost-format.mjs";

describe("cloud-cost-format", () => {
  it("sums line items", () => {
    const sum = sumLineItems([
      { label: "vm", monthly_usd: 30, hourly_usd: 0.04 },
      { label: "disk", monthly_usd: 5 },
    ]);
    expect(sum.monthly_usd).toBe(35);
    expect(sum.hourly_usd).toBeCloseTo(0.04);
  });

  it("formats USD", () => {
    expect(formatUsd(12.5)).toBe("USD 12.50");
    expect(formatUsd(null)).toBe("unknown");
  });

  it("renders markdown table", () => {
    const md = formatCostEstimateMarkdown({
      monthly_usd: 35,
      hourly_usd: 0.05,
      currency: "USD",
      source: "Azure Retail Prices API",
      line_items: [{ label: "VM", quantity: 1, unit: "hour", monthly_usd: 35, hourly_usd: 0.05 }],
      disclaimer: "Estimate only",
    });
    expect(md.some((l) => l.includes("Estimated monthly"))).toBe(true);
    expect(md.some((l) => l.includes("| VM |"))).toBe(true);
  });

  it("detects unknown estimates", () => {
    expect(isUnknownCostEstimate({ monthly_usd: null, currency: "USD", line_items: [] })).toBe(true);
    expect(isUnknownCostEstimate({ monthly_usd: 10, currency: "USD", line_items: [] })).toBe(false);
    expect(isUnknownCostEstimate({ monthly_usd: 10, currency: "USD", line_items: [], unknown: true })).toBe(
      true,
    );
  });
});
