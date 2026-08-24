import { describe, expect, it } from "vitest";
import { buildOpenEvidenceValuation } from "@/adapters/propertyData";
import type { PropertyValuationEvidence } from "@/domain/types";

describe("deterministic property valuation weighting", () => {
  it("requires two independent value sources", () => {
    const evidence: PropertyValuationEvidence[] = [
      { id: "borrower", kind: "BORROWER_ESTIMATE", value: 500_000, retrievedAt: "2026-08-24T00:00:00Z", sourceLabel: "Borrower", reliability: 0.35 },
      { id: "assessor", kind: "ASSESSOR", value: 450_000, retrievedAt: "2026-08-24T00:00:00Z", sourceLabel: "Assessor", reliability: 0.72 },
    ];
    expect(buildOpenEvidenceValuation({ stateCode: "CA" }, evidence)).toBeUndefined();
  });

  it("weights evidence deterministically and never asks an LLM for a value", () => {
    const evidence: PropertyValuationEvidence[] = [
      { id: "borrower", kind: "BORROWER_ESTIMATE", value: 500_000, retrievedAt: "2026-08-24T00:00:00Z", sourceLabel: "Borrower", reliability: 0.35 },
      { id: "assessor", kind: "ASSESSOR", value: 450_000, retrievedAt: "2026-08-24T00:00:00Z", sourceLabel: "Assessor", reliability: 0.72 },
      { id: "public", kind: "PUBLIC_RECORD", value: 475_000, retrievedAt: "2026-08-24T00:00:00Z", sourceLabel: "Open data", reliability: 0.68 },
    ];
    const result = buildOpenEvidenceValuation({ stateCode: "CA", currentBalance: 200_000 }, evidence);
    expect(result?.estimatedValue).toBe(470_000);
    expect(result?.method).toBe("OPEN_EVIDENCE");
    expect(result?.estimatedLTV).toBe(42.6);
  });
});
