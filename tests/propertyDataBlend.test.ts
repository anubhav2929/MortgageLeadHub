import { describe, expect, it } from "vitest";
import { blendRentCastWithOpenEvidence } from "@/adapters/propertyData";
import type { PropertyValuationResult } from "@/domain/types";

function valuation(method: "RENTCAST" | "OPEN_EVIDENCE", value: number): PropertyValuationResult {
  return {
    estimatedValue: value,
    confidenceLow: value - 30_000,
    confidenceHigh: value + 30_000,
    comparableCount: 3,
    estimatedMortgageBalance: 300_000,
    propertyType: "SINGLE_FAMILY",
    yearBuilt: 2000,
    estimatedLTV: 60,
    usableEquity: value - 300_000,
    simulated: false,
    method,
    confidence: "MEDIUM",
    provenance: {
      estimatedValue: "MEASURED", confidenceRange: "MEASURED", comparableCount: "MEASURED", lastSale: "MODELED",
      estimatedMortgageBalance: "MEASURED", estimatedLTV: "MODELED", usableEquity: "MODELED",
      propertyType: "MEASURED", yearBuilt: "MEASURED",
    },
    evidence: [{
      id: method, kind: method === "RENTCAST" ? "RENTCAST" : "PUBLIC_RECORD", value,
      retrievedAt: "2026-09-02T00:00:00.000Z", sourceLabel: method, reliability: 0.9,
    }],
  };
}

describe("RentCast-primary valuation blend", () => {
  it("weights RentCast at 75% while retaining both evidence layers", () => {
    const result = blendRentCastWithOpenEvidence(valuation("RENTCAST", 500_000), valuation("OPEN_EVIDENCE", 400_000));
    expect(result.method).toBe("RENTCAST_WEIGHTED");
    expect(result.estimatedValue).toBe(475_000);
    expect(result.evidence?.map((item) => item.kind)).toEqual(["RENTCAST", "PUBLIC_RECORD"]);
    expect(result.estimatedLTV).toBeCloseTo(63.2, 1);
  });
});
