import { beforeEach, describe, expect, it } from "vitest";
import { IDEMPOTENCY_WINDOW_MS, alreadyProcessed, processedCount, resetProcessed } from "@/core/idempotency";

// Telnyx and Vapi both deliver at-least-once. Without this, a duplicated
// inbound SMS became two borrower messages, and a duplicated transcript event
// became a repeated line — which then poisons the AI brief for the NEXT call,
// because the brief is built from the transcript.

beforeEach(() => resetProcessed());

describe("duplicate suppression", () => {
  it("reports the first occurrence as new and the second as seen", () => {
    expect(alreadyProcessed("msg-1")).toBe(false);
    expect(alreadyProcessed("msg-1")).toBe(true);
  });

  it("keeps distinct events independent", () => {
    expect(alreadyProcessed("a")).toBe(false);
    expect(alreadyProcessed("b")).toBe(false);
  });

  it("forgets an event once the retry window has passed", () => {
    const t0 = 1_000_000;
    expect(alreadyProcessed("old", t0)).toBe(false);
    expect(alreadyProcessed("old", t0 + IDEMPOTENCY_WINDOW_MS + 1)).toBe(false);
  });
});

describe("never pretends to dedupe what it cannot", () => {
  it("treats an empty key as always new", () => {
    // A provider that sends no message id gives us nothing to key on.
    // Returning true would silently discard real events.
    expect(alreadyProcessed("")).toBe(false);
    expect(alreadyProcessed("")).toBe(false);
  });
});

describe("bounded memory", () => {
  it("does not grow without limit under a burst of unique events", () => {
    for (let i = 0; i < 8000; i++) alreadyProcessed(`k${i}`);
    expect(processedCount()).toBeLessThanOrEqual(5000);
  });
});
