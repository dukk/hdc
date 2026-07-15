import { describe, expect, it } from "vitest";

import {
  buildCostEstimate,
  formatCostEstimateTableLines,
  formatUsd,
  mergeCostEstimates,
} from "./aws-cost-estimate.mjs";

describe("buildCostEstimate", () => {
  it("sums line totals", () => {
    const est = buildCostEstimate([
      { resource_id: "vm-a", service: "EC2", monthly_usd: 10.5 },
      { resource_id: "disk-a", service: "EBS", monthly_usd: 2.25 },
    ]);
    expect(est.total_monthly_usd).toBe(12.75);
    expect(est.currency).toBe("USD");
    expect(est.lines).toHaveLength(2);
  });

  it("filters invalid amounts", () => {
    const est = buildCostEstimate([
      { resource_id: "x", service: "EC2", monthly_usd: NaN },
      { resource_id: "y", service: "EC2", monthly_usd: -1 },
    ]);
    expect(est.total_monthly_usd).toBe(0);
    expect(est.lines).toHaveLength(0);
  });
});

describe("formatUsd", () => {
  it("formats numbers", () => {
    expect(formatUsd(12.3)).toBe("$12.30");
  });
});

describe("mergeCostEstimates", () => {
  it("combines lines and dedupes warnings", () => {
    const merged = mergeCostEstimates(
      buildCostEstimate([{ resource_id: "a", service: "EC2", monthly_usd: 1 }], {
        warnings: ["nat"],
      }),
      buildCostEstimate([{ resource_id: "b", service: "S3", monthly_usd: 2 }], {
        warnings: ["nat", "transfer"],
      }),
    );
    expect(merged.lines).toHaveLength(2);
    expect(merged.total_monthly_usd).toBe(3);
    expect(merged.warnings).toEqual(["nat", "transfer"]);
  });
});

describe("formatCostEstimateTableLines", () => {
  it("renders table header and total", () => {
    const lines = formatCostEstimateTableLines(
      buildCostEstimate([{ resource_id: "ec2-a", service: "EC2", monthly_usd: 5 }]),
    );
    expect(lines[0]).toContain("Cost estimate");
    expect(lines.some((l) => l.includes("Total:"))).toBe(true);
  });
});
