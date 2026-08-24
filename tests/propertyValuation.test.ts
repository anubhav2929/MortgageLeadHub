import { describe, expect, it } from "vitest";
import { buildOpenEvidenceValuation, findFhfaAdjustment, parsePublicRecordSources } from "@/adapters/propertyData";
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

  it("parses multiple generic and ArcGIS sources but caps external fan-out", () => {
    const source = { label: "County", endpoint: "https://data.county.gov/property", format: "GENERIC_JSON" };
    const raw = JSON.stringify([
      source,
      { label: "ArcGIS", endpoint: "https://services.arcgis.com/x/FeatureServer/0/query", format: "ARCGIS", addressField: "SITE_ADDR" },
      ...Array.from({ length: 10 }, (_, index) => ({ ...source, label: `County ${index}` })),
    ]);
    const parsed = parsePublicRecordSources(raw);
    expect(parsed).toHaveLength(8);
    expect(parsed[1].format).toBe("ARCGIS");
  });

  it("time-adjusts a recorded sale from official quarterly HPI rows", () => {
    const rows = [
      { level: "State", place_id: "CA", hpi_type: "purchase-only", frequency: "quarterly", yr: 2020, period: 2, index_nsa: 200 },
      { level: "State", place_id: "CA", hpi_type: "purchase-only", frequency: "quarterly", yr: 2026, period: 1, index_nsa: 250 },
    ];
    expect(findFhfaAdjustment(rows, "CA", "2020-05-15", 400_000)).toBe(500_000);
  });

  it("rejects unsafe ArcGIS field names before any request can be formed", () => {
    expect(() => parsePublicRecordSources(JSON.stringify([
      { endpoint: "https://services.arcgis.com/x/query", format: "ARCGIS", addressField: "ADDR); DROP TABLE" },
    ]))).toThrow(/safe addressField/);
  });
});
