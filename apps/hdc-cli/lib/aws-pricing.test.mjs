import { describe, expect, it } from "vitest";

import { extractOnDemandUnitPrice } from "../../../clumps/infrastructure/aws/lib/aws-pricing.mjs";

const sampleEc2Product = [
  {
    terms: {
      OnDemand: {
        term1: {
          priceDimensions: {
            dim1: {
              unit: "Hrs",
              pricePerUnit: { USD: "0.0208" },
            },
          },
        },
      },
    },
  },
];

describe("extractOnDemandUnitPrice", () => {
  it("extracts hourly rate", () => {
    expect(extractOnDemandUnitPrice(sampleEc2Product, "Hrs")).toBe(0.0208);
  });

  it("returns null when unit not found", () => {
    expect(extractOnDemandUnitPrice(sampleEc2Product, "GB-Mo")).toBeNull();
  });
});
