import { describe, expect, it } from "vitest";
import { isReusablePropertyValuation, propertyClarifications } from "@/core/propertyValuationQuality";
import type { PropertyValuationResult } from "@/domain/types";

function valuation(overrides: Partial<PropertyValuationResult> = {}): PropertyValuationResult {
  return {
    estimatedValue: 500_000,
    confidenceLow: 470_000,
    confidenceHigh: 530_000,
    comparableCount: 2,
    estimatedMortgageBalance: 350_000,
    propertyType: "SINGLE_FAMILY",
    yearBuilt: 1998,
    estimatedLTV: 70,
    usableEquity: 150_000,
    simulated: false,
    method: "OPEN_EVIDENCE",
    confidence: "MEDIUM",
    provenance: {
      estimatedValue: "MEASURED",
      confidenceRange: "MODELED",
      comparableCount: "MEASURED",
      lastSale: "MODELED",
      estimatedMortgageBalance: "MODELED",
      estimatedLTV: "MODELED",
      usableEquity: "MODELED",
      propertyType: "MEASURED",
      yearBuilt: "MEASURED",
    },
    evidence: [],
    ...overrides,
  };
}

describe("property valuation data quality", () => {
  it("retires every legacy simulated cache", () => {
    expect(isReusablePropertyValuation(valuation())).toBe(true);
    expect(isReusablePropertyValuation(valuation({ simulated: true }))).toBe(false);
    expect(isReusablePropertyValuation(valuation({ method: "SIMULATED" }))).toBe(false);
  });

  it("asks targeted questions for missing property facts", () => {
    const result = propertyClarifications(
      { stateCode: "CA", estimatedValue: undefined, currentBalance: undefined },
      valuation({
        method: "INSUFFICIENT_EVIDENCE",
        confidence: "INSUFFICIENT",
        estimatedValue: 0,
        yearBuilt: 0,
        provenance: { ...valuation().provenance, propertyType: "MODELED", yearBuilt: "MODELED" },
      })
    );

    expect(result.map((item) => item.id)).toEqual(expect.arrayContaining([
      "street", "city", "postal", "borrower-value", "balance", "property-type", "year-built", "purchase",
    ]));
  });

  it("flags a material conflict without overwriting the borrower value", () => {
    const result = propertyClarifications(
      {
        addressLine1: "1 Main St",
        city: "Los Angeles",
        stateCode: "CA",
        postalCode: "90001",
        estimatedValue: 700_000,
        currentBalance: 300_000,
      },
      valuation({ estimatedValue: 500_000 })
    );
    expect(result.map((item) => item.id)).toContain("value-conflict");
  });
});
