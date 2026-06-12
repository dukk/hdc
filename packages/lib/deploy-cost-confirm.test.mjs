import { describe, expect, it } from "vitest";
import { Readable, Writable } from "node:stream";

import { buildCostEstimate } from "./aws-cost-estimate.mjs";
import {
  acceptUnknownCost,
  confirmDeployCost,
  deployCostConfirmed,
  deployCostDryRun,
  validateCostEstimateForDeploy,
} from "./deploy-cost-confirm.mjs";

describe("deploy-cost-confirm", () => {
  const sampleEstimate = buildCostEstimate([
    { resource_id: "virt-a", service: "VM", monthly_usd: 12.5 },
  ]);

  it("detects flags", () => {
    expect(deployCostDryRun({ "dry-run": "1" })).toBe(true);
    expect(deployCostConfirmed({ yes: "1" })).toBe(true);
    expect(acceptUnknownCost({ "accept-unknown-cost": "1" })).toBe(true);
  });

  it("dry-run returns proceed false", async () => {
    const result = await confirmDeployCost({
      estimate: sampleEstimate,
      flags: { "dry-run": "1" },
    });
    expect(result.proceed).toBe(false);
  });

  it("--yes proceeds without TTY", async () => {
    const result = await confirmDeployCost({
      estimate: sampleEstimate,
      flags: { yes: "1" },
    });
    expect(result.proceed).toBe(true);
    expect(result.confirmed).toBe(true);
  });

  it("non-TTY without --yes throws", async () => {
    const input = Readable.from([]);
    Object.defineProperty(input, "isTTY", { value: false });
    await expect(
      confirmDeployCost({
        estimate: sampleEstimate,
        flags: {},
        input,
      }),
    ).rejects.toThrow(/Non-interactive deploy/);
  });

  it("TTY prompt accepts y", async () => {
    const input = Readable.from(["y\n"]);
    Object.defineProperty(input, "isTTY", { value: true });
    /** @type {string[]} */
    const out = [];
    const output = new Writable({
      write(chunk, _enc, cb) {
        out.push(String(chunk));
        cb();
      },
    });

    const result = await confirmDeployCost({
      estimate: sampleEstimate,
      flags: {},
      input,
      output,
    });
    expect(result.proceed).toBe(true);
    expect(out.join("")).toMatch(/Proceed with estimated/);
  });

  it("blocks unknown cost without escape hatch", () => {
    const empty = buildCostEstimate([], { warnings: ["unavailable"] });
    expect(() => validateCostEstimateForDeploy(empty, {})).toThrow(/Cost estimate unavailable/);
    expect(() => validateCostEstimateForDeploy(empty, { "accept-unknown-cost": "1" })).not.toThrow();
  });
});
