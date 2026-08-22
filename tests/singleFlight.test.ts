import { describe, expect, it } from "vitest";
import { inFlightCount, singleFlight } from "@/core/singleFlight";

// The board polls every 3s from every open tab. Without this, each poll kicked
// off its own reconcile pass; two passes interleaved on shared state and the
// slower write won — which is how a call that had just been confirmed alive
// got reaped anyway.

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("concurrent callers join one pass", () => {
  it("runs the job once for simultaneous callers", async () => {
    let runs = 0;
    const job = async () => {
      runs += 1;
      await tick(20);
      return runs;
    };
    const results = await Promise.all([
      singleFlight("k", job),
      singleFlight("k", job),
      singleFlight("k", job),
    ]);
    expect(runs).toBe(1);
    // Joiners get the same result, not undefined.
    expect(results).toEqual([1, 1, 1]);
  });

  it("allows a fresh run once the first completes", async () => {
    let runs = 0;
    const job = async () => {
      runs += 1;
      return runs;
    };
    await singleFlight("k2", job);
    await singleFlight("k2", job);
    expect(runs).toBe(2);
  });

  it("keeps unrelated keys independent", async () => {
    let a = 0;
    let b = 0;
    await Promise.all([
      singleFlight("a", async () => { a += 1; await tick(10); }),
      singleFlight("b", async () => { b += 1; await tick(10); }),
    ]);
    expect(a).toBe(1);
    expect(b).toBe(1);
  });
});

describe("a failing job never wedges the key", () => {
  it("clears in-flight state after a rejection", async () => {
    // A stuck key would freeze the board's state at whatever it was when the
    // first failure happened, permanently.
    await expect(singleFlight("boom", async () => { throw new Error("x"); })).rejects.toThrow("x");
    expect(inFlightCount()).toBe(0);

    let ran = false;
    await singleFlight("boom", async () => { ran = true; });
    expect(ran).toBe(true);
  });
});
