import { describe, expect, it } from "vitest";
import {
  CONNECTED_TIMEOUT_MINUTES,
  UNCONNECTED_TIMEOUT_MINUTES,
  evaluateStaleCall,
  staleAttemptOutcome,
} from "@/core/staleCall";

// A session is closed by exactly one thing: the provider's end-of-call report.
// When that never arrives the session stays IN_PROGRESS with no expiry — and
// because pre-flight refuses to call someone already "on a call", one dropped
// webhook would take a lead out of the pipeline permanently.

const NOW = new Date("2026-08-16T12:00:00Z");
const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

describe("a call that never connected", () => {
  it("is reaped quickly — carriers stop ringing long before this", () => {
    const v = evaluateStaleCall({
      callStatus: "QUEUED",
      startedAt: minsAgo(UNCONNECTED_TIMEOUT_MINUTES + 1),
      now: NOW,
    });
    expect(v.stale).toBe(true);
    expect(v.neverConnected).toBe(true);
  });

  it("is left alone inside the window", () => {
    expect(
      evaluateStaleCall({ callStatus: "RINGING", startedAt: minsAgo(UNCONNECTED_TIMEOUT_MINUTES - 1), now: NOW }).stale
    ).toBe(false);
  });
});

describe("a connected call gets far longer", () => {
  it("survives well past the unconnected limit", () => {
    // Reaping a genuinely live call would cut off a real conversation, which
    // is much worse than a stale row lingering.
    expect(evaluateStaleCall({ callStatus: "CONNECTED", startedAt: minsAgo(20), now: NOW }).stale).toBe(false);
  });

  it("is eventually reaped too", () => {
    const v = evaluateStaleCall({
      callStatus: "CONNECTED",
      startedAt: minsAgo(CONNECTED_TIMEOUT_MINUTES + 1),
      now: NOW,
    });
    expect(v.stale).toBe(true);
    expect(v.neverConnected).toBe(false);
  });
});

describe("staleness is measured from webhook silence, not call age", () => {
  it("keeps a long call alive while events are still arriving", () => {
    // A 40-minute conversation still emitting transcript events is live, not
    // stuck. Measuring from startedAt would kill it mid-sentence.
    expect(
      evaluateStaleCall({
        callStatus: "CONNECTED",
        startedAt: minsAgo(CONNECTED_TIMEOUT_MINUTES + 10),
        lastSignalAt: minsAgo(1),
        now: NOW,
      }).stale
    ).toBe(false);
  });
});

describe("degenerate input", () => {
  it("reaps an unreadable timestamp rather than leaving it open forever", () => {
    // Leaving it open is the exact outcome this module exists to prevent.
    expect(evaluateStaleCall({ callStatus: "QUEUED", startedAt: "not-a-date", now: NOW }).stale).toBe(true);
  });

  it("ignores clock skew from the future", () => {
    expect(
      evaluateStaleCall({ callStatus: "QUEUED", startedAt: new Date(NOW.getTime() + 60_000).toISOString(), now: NOW })
        .stale
    ).toBe(false);
  });

  it("never reaps an already-ended call", () => {
    expect(evaluateStaleCall({ callStatus: "ENDED", startedAt: minsAgo(999), now: NOW }).stale).toBe(false);
  });
});

describe("what we claim happened", () => {
  it("never claims the borrower was reached", () => {
    // Asserting ANSWERED would advance the lead to IN_CONVERSATION and put a
    // call with no transcript in front of an officer as an opportunity.
    expect(staleAttemptOutcome(true)).toBe("FAILED");
    expect(staleAttemptOutcome(false)).toBe("NO_ANSWER");
  });
});
