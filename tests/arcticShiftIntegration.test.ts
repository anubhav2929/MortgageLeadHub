import { afterEach, describe, expect, it, vi } from "vitest";
import { ALL_INTEGRATION_KEYS, findIntegration } from "@/core/integrationRegistry";
import { verifyArcticShiftConnection } from "@/adapters/leadDiscovery";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Arctic Shift integration contract", () => {
  it("is visible by name in Admin and needs no credentials", () => {
    const integration = findIntegration("arctic-shift");

    expect(integration?.name).toContain("Arctic Shift");
    expect(integration?.category).toBe("Data");
    expect(integration?.requiredKeys).toEqual([]);
    expect(integration?.fields).toEqual([]);
  });

  it("does not reintroduce the removed archive approval setting", () => {
    expect(ALL_INTEGRATION_KEYS).not.toContain("DISCOVERY_ARCHIVE_APPROVED");
  });

  it("health-checks the same bounded latest-data endpoint without credentials", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(verifyArcticShiftConnection()).resolves.toEqual({
      ok: true,
      message: "Arctic Shift is reachable — no credentials are required.",
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("arctic-shift.photon-reddit.com/api/posts/search");
    expect(url).toContain("subreddit=Mortgages");
    expect(url).toContain("limit=1");
    expect(url).not.toContain("after=");
    expect(init.headers).not.toHaveProperty("Authorization");
  });
});
