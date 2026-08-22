import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "@/core/concurrency";

// Two hand-rolled worker pools existed before this — one for AI assessment,
// one for archive sweeps — solving the same problem with the same bugs
// available to each.

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe("results stay aligned with input", () => {
  it("returns results in input order regardless of completion order", async () => {
    // Callers zip results back against the input array, so an out-of-order
    // result would silently attach one lead's assessment to another's signal.
    const out = await mapWithConcurrency([30, 0, 15], 3, async (ms, i) => {
      await tick(ms);
      return i;
    });
    expect(out).toEqual([0, 1, 2]);
  });

  it("handles an empty list without spawning workers", async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([]);
  });
});

describe("the limit is respected", () => {
  it("never exceeds the requested concurrency", async () => {
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency(Array.from({ length: 20 }, (_, i) => i), 4, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await tick(1);
      inFlight -= 1;
      return null;
    });
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
  });

  it("degrades to sequential rather than hanging on a zero limit", async () => {
    // Spawning zero workers would leave the promise unresolved forever.
    expect(await mapWithConcurrency([1, 2, 3], 0, async (n) => n * 2)).toEqual([2, 4, 6]);
  });

  it("does not spawn more workers than items", async () => {
    expect(await mapWithConcurrency([1], 100, async (n) => n)).toEqual([1]);
  });
});

describe("failure", () => {
  it("propagates a rejection like Promise.all", async () => {
    // Callers wanting partial results catch inside fn — which is what the
    // discovery sweep does so one bad subreddit costs only that subreddit.
    await expect(
      mapWithConcurrency([1, 2], 2, async (n) => {
        if (n === 2) throw new Error("boom");
        return n;
      })
    ).rejects.toThrow("boom");
  });
});
