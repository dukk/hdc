import { describe, expect, it } from "vitest";

import { buildCostEstimate } from "./aws-cost-estimate.mjs";
import {
  attachCostReportToPayload,
  costMetaFromPayload,
  renderCostEstimateMarkdown,
} from "./cost-report.mjs";

describe("cost-report", () => {
  it("round-trips estimate on payload", () => {
    const estimate = buildCostEstimate([
      { resource_id: "vpc-main", service: "NAT", monthly_usd: 32.4, notes: "hourly" },
    ]);
    /** @type {Record<string, unknown>} */
    const payload = {};
    attachCostReportToPayload(payload, { estimate, confirmed: true });
    const meta = costMetaFromPayload(payload);
    expect(meta.estimate?.total_monthly_usd).toBe(32.4);
    expect(meta.confirmed).toBe(true);
    const md = renderCostEstimateMarkdown(meta);
    expect(md.join("\n")).toContain("## Cost estimate");
    expect(md.join("\n")).toContain("vpc-main");
  });
});
