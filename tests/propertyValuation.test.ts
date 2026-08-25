import { describe, expect, it, vi } from "vitest";
import {
  buildInsufficientPropertyValuation,
  buildOpenEvidenceValuation,
  discoverArcGisPropertySources,
  findFhfaAdjustment,
  parseAcsHousingValue,
  parseAcsSummaryValue,
  parseCensusGeography,
  parsePublicRecordSources,
} from "@/adapters/propertyData";
import type { PropertyValuationEvidence } from "@/domain/types";

describe("deterministic property valuation weighting", () => {
  it("sanitizes stale valuations without inventing a replacement value", () => {
    const result = buildInsufficientPropertyValuation({
      stateCode: "CA",
      estimatedValue: 525_000,
      currentBalance: 310_000,
    });
    expect(result).toMatchObject({
      method: "INSUFFICIENT_EVIDENCE",
      simulated: false,
      estimatedValue: 0,
      estimatedMortgageBalance: 310_000,
    });
    expect(result.evidence).toEqual([
      expect.objectContaining({ kind: "BORROWER_ESTIMATE", value: 525_000, reliability: 0.35 }),
    ]);
  });

  it("keeps a borrower-reported paid-off balance as measured zero", () => {
    const result = buildInsufficientPropertyValuation({ stateCode: "CA", currentBalance: 0 });
    expect(result.estimatedMortgageBalance).toBe(0);
    expect(result.provenance.estimatedMortgageBalance).toBe("MEASURED");
  });

  it("does not promote a borrower estimate without independent evidence", () => {
    const evidence: PropertyValuationEvidence[] = [
      { id: "borrower", kind: "BORROWER_ESTIMATE", value: 500_000, retrievedAt: "2026-08-24T00:00:00Z", sourceLabel: "Borrower", reliability: 0.35 },
    ];
    expect(buildOpenEvidenceValuation({ stateCode: "CA" }, evidence)).toBeUndefined();
  });

  it("creates a wide low-confidence range from an official Census neighborhood benchmark", () => {
    const evidence: PropertyValuationEvidence[] = [
      { id: "borrower", kind: "BORROWER_ESTIMATE", value: 500_000, retrievedAt: "2026-08-24T00:00:00Z", sourceLabel: "Borrower", reliability: 0.35 },
      { id: "census", kind: "CENSUS_MARKET", value: 450_000, retrievedAt: "2026-08-24T00:00:00Z", sourceLabel: "US Census ACS", reliability: 0.58 },
    ];
    const result = buildOpenEvidenceValuation({ stateCode: "CA" }, evidence);
    expect(result).toMatchObject({ method: "OPEN_EVIDENCE", confidence: "LOW", comparableCount: 1 });
    expect(result!.confidenceHigh - result!.confidenceLow).toBeGreaterThan(result!.estimatedValue * 0.4);
    expect(result!.provenance.estimatedValue).toBe("MODELED");
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

  it("extracts tract geography and ACS median-value rows", () => {
    expect(parseCensusGeography({
      geographies: { "Census Tracts": [{ STATE: "06", COUNTY: "037", TRACT: "123400" }] },
    })).toEqual({ state: "06", county: "037", tract: "123400" });
    expect(parseAcsHousingValue([
      ["NAME", "B25077_001E", "B25077_001M"],
      ["Census Tract 1234, California", "650000", "25000"],
    ])).toEqual({ name: "Census Tract 1234, California", value: 650000, marginOfError: 25000 });
    expect(parseAcsSummaryValue(
      "GEO_ID|B25077_E001|B25077_M001\n1400000US06037123400|625000|18000\n1400000US06037123500|640000|19000\n",
      "1400000US06037123400"
    )).toEqual({ value: 625000, marginOfError: 18000 });
  });

  it("turns a safe discovered ArcGIS schema into a bounded read-only source", async () => {
    const originalFetch = globalThis.fetch;
    const catalogResponse = () => new Response(JSON.stringify({ results: [{
      title: "County Assessor Parcels",
      owner: "county_gis",
      tags: ["assessor", "parcel"],
      url: "https://services.arcgis.com/example/arcgis/rest/services/Parcels/FeatureServer",
    }] }), { headers: { "content-type": "application/json" } });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(catalogResponse())
      .mockResolvedValueOnce(catalogResponse())
      .mockResolvedValueOnce(catalogResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({ tables: [{ id: 0, name: "Assessor Parcel Roll" }] }), { headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ fields: [
        { name: "SITUS_ADDR", alias: "Situs Address", type: "esriFieldTypeString" },
        { name: "TOTAL_VALUE", alias: "Total Assessed Value", type: "esriFieldTypeDouble" },
        { name: "ROLL_YEAR", alias: "Roll Year", type: "esriFieldTypeInteger" },
        { name: "YEAR_BUILT", alias: "Year Built", type: "esriFieldTypeInteger" },
      ] }), { headers: { "content-type": "application/json" } }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const sources = await discoverArcGisPropertySources("Los Angeles CA");
      expect(sources).toHaveLength(1);
      expect(sources[0]).toMatchObject({
        format: "ARCGIS",
        addressField: "SITUS_ADDR",
        orderByField: "ROLL_YEAR",
        fieldMap: { assessedValue: "TOTAL_VALUE", yearBuilt: "YEAR_BUILT" },
      });
      expect(sources[0].endpoint).toMatch(/^https:\/\/services\.arcgis\.com\/.+\/query$/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
