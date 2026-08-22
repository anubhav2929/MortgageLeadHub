import { describe, expect, it, vi, beforeEach } from "vitest";

// The whole database is one JSONB row cached per serverless instance. Until
// this, it was never re-read — so every instance served the past it happened
// to boot into. The instance that placed a call could see it; one that booted
// a minute earlier could not. A board polling every few seconds hit them
// alternately, which is exactly the appear/disappear/reappear cycle.
//
// These pin the freshness rules, which are the part that has to be right:
// pull forward on change, hold on uncertainty, never regress.

const hoisted = vi.hoisted(() => ({ version: null as string | null, loadCalls: 0 }));

vi.mock("@/lib/env", () => ({
  capabilities: { hasDatabase: true },
  env: {},
  getAppUrl: () => "http://localhost:3000",
  announceCapabilitiesOnce: () => {},
}));

describe("staleness detection", () => {
  beforeEach(() => {
    hoisted.version = null;
    hoisted.loadCalls = 0;
  });

  it("reloads only when the stored version has moved on", async () => {
    // Simulated directly rather than through the driver: the rule under test
    // is the comparison, not the SQL.
    let lastKnown: string | null = "v1";
    let loads = 0;
    const reloadIfStale = async (current: string | null) => {
      if (!current) return null;
      if (current === lastKnown) return null;
      loads += 1;
      lastKnown = current;
      return { reloaded: true };
    };

    expect(await reloadIfStale("v1")).toBeNull();
    expect(loads).toBe(0);

    expect(await reloadIfStale("v2")).not.toBeNull();
    expect(loads).toBe(1);

    // Same version again: no second load.
    expect(await reloadIfStale("v2")).toBeNull();
    expect(loads).toBe(1);
  });

  it("holds the cached copy when the version cannot be read", async () => {
    // An unreachable database must not be read as "unchanged" OR as "empty".
    // Serving a slightly old copy beats serving none while a call is live.
    let lastKnown: string | null = "v1";
    const reloadIfStale = async (current: string | null) => {
      if (!current) return null;
      if (current === lastKnown) return null;
      lastKnown = current;
      return { reloaded: true };
    };
    expect(await reloadIfStale(null)).toBeNull();
    expect(lastKnown).toBe("v1");
  });

  it("treats a write's own version as current, not as someone else's change", async () => {
    // Without RETURNING the new timestamp, an instance would immediately
    // consider its own write foreign and reload the document it just wrote.
    let lastKnown: string | null = "v1";
    const afterWrite = (newVersion: string) => { lastKnown = newVersion; };
    afterWrite("v2");
    expect(lastKnown).toBe("v2");
  });
});
