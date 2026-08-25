import { describe, expect, it, vi } from "vitest";
import { verifyPublicDataIntegration } from "@/adapters/publicData";
import { verifyPropertyEvidenceConnection } from "@/adapters/propertyData";
import { findIntegration } from "@/core/integrationRegistry";

describe("public-data provider orchestration", () => {
  it("exposes property evidence as its own configurable Admin integration", () => {
    const property = findIntegration("public-data");
    const discovery = findIntegration("arctic-shift");

    expect(property?.name).toContain("Property Valuation");
    expect(property?.fields.map((field) => field.key)).toContain("CENSUS_DATA_API_KEY");
    expect(property?.powers).toContain("independent valuation lane");
    expect(discovery?.name).toContain("Arctic Shift");
  });

  it("starts Arctic Shift and property evidence concurrently", async () => {
    let active = 0;
    let maxActive = 0;
    const lane = (message: string) => vi.fn(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return { ok: true, message };
    });
    const search = lane("archive ready");
    const property = lane("records ready");

    const result = await verifyPublicDataIntegration(search, property);

    expect(maxActive).toBe(2);
    expect(search).toHaveBeenCalledOnce();
    expect(property).toHaveBeenCalledOnce();
    expect(result.ok).toBe(true);
    expect(result.lanes.map((item) => item.id)).toEqual(["PUBLIC_SEARCH", "PROPERTY_EVIDENCE"]);
  });

  it("isolates a failed lane while retaining the other result", async () => {
    const result = await verifyPublicDataIntegration(
      async () => { throw new Error("archive timeout"); },
      async () => ({ ok: true, message: "records ready" })
    );

    expect(result.ok).toBe(false);
    expect(result.lanes[0]).toMatchObject({ ok: false, message: "archive timeout" });
    expect(result.lanes[1]).toMatchObject({ ok: true, message: "records ready" });
  });

  it("checks Census, FHFA, and ArcGIS concurrently without using Arctic Shift as valuation evidence", async () => {
    let active = 0;
    let maxActive = 0;
    const fetchMock = vi.fn(async (_input: URL | RequestInfo, _init?: RequestInit) => {
      void _input;
      void _init;
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return { ok: true, body: null } as Response;
    });
    const fetchImpl = fetchMock as unknown as typeof fetch;

    const result = await verifyPropertyEvidenceConnection({ fetchImpl, config: {} });

    expect(result.ok).toBe(true);
    expect(maxActive).toBe(4);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const calledUrls = fetchMock.mock.calls.flatMap((call) => String(call[0]));
    expect(calledUrls).toEqual(expect.arrayContaining([
      expect.stringContaining("arcgis.com/sharing/rest/search"),
      expect.stringContaining("www2.census.gov/programs-surveys/acs/summary_file"),
    ]));
    expect(calledUrls).not.toEqual(
      expect.arrayContaining([expect.stringContaining("arctic-shift")])
    );
  });
});
