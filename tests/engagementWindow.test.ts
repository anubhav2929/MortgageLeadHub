import { describe, expect, it } from "vitest";
import {
  evaluateEngagementWindow,
  DEFAULT_ENGAGEMENT_WINDOW_MINUTES,
  type EngagementInput,
} from "@/core/engagementWindow";

// Holds automated outreach while the borrower is live in the post-submit chat.
// The failure that matters most is not the wasted SMS segment — it is a lead
// whose cadence freezes forever because a bad timestamp made the window never
// lapse. Every degenerate input below has to fail OPEN.

const NOW = new Date("2026-08-11T15:00:00Z");

function input(overrides: Partial<EngagementInput> = {}): EngagementInput {
  return {
    lastEngagedAt: new Date(NOW.getTime() - 60_000).toISOString(), // 1 min ago
    now: NOW,
    windowMinutes: 5,
    isAutomated: true,
    ...overrides,
  };
}

describe("holding while the borrower is active", () => {
  it("defers when they interacted a minute ago", () => {
    const result = evaluateEngagementWindow(input());
    expect(result.defer).toBe(true);
    expect(result.reason).toMatch(/active in the chat/i);
  });

  it("reports when the hold lifts, so the step is retried rather than lost", () => {
    const result = evaluateEngagementWindow(input());
    expect(result.retryAt).toBeInstanceOf(Date);
    expect(result.retryAt!.getTime()).toBe(NOW.getTime() - 60_000 + 5 * 60_000);
  });

  it("proceeds once the window has lapsed", () => {
    const result = evaluateEngagementWindow(
      input({ lastEngagedAt: new Date(NOW.getTime() - 6 * 60_000).toISOString() })
    );
    expect(result.defer).toBe(false);
    expect(result.reason).toMatch(/lapsed/i);
  });

  it("treats the boundary as lapsed, not held", () => {
    // Exactly at the window edge the hold is over — otherwise a 5-minute
    // window is really 5-minutes-and-a-bit, and the boundary drifts.
    const result = evaluateEngagementWindow(
      input({ lastEngagedAt: new Date(NOW.getTime() - 5 * 60_000).toISOString() })
    );
    expect(result.defer).toBe(false);
  });

  it("honours a configured window instead of the default", () => {
    const twoMinAgo = new Date(NOW.getTime() - 2 * 60_000).toISOString();
    expect(evaluateEngagementWindow(input({ lastEngagedAt: twoMinAgo, windowMinutes: 10 })).defer).toBe(true);
    expect(evaluateEngagementWindow(input({ lastEngagedAt: twoMinAgo, windowMinutes: 1 })).defer).toBe(false);
  });

  it("falls back to the documented default when no window is configured", () => {
    expect(DEFAULT_ENGAGEMENT_WINDOW_MINUTES).toBe(5);
    const result = evaluateEngagementWindow({
      lastEngagedAt: new Date(NOW.getTime() - 60_000).toISOString(),
      now: NOW,
      isAutomated: true,
    });
    expect(result.defer).toBe(true);
  });
});

describe("manual officer action is never held", () => {
  it("proceeds even while the borrower is mid-chat", () => {
    // An officer reading the live chat and deciding to call is making an
    // informed decision. Nothing here should overrule it.
    const result = evaluateEngagementWindow(input({ isAutomated: false }));
    expect(result.defer).toBe(false);
    expect(result.reason).toMatch(/manual/i);
  });
});

describe("degenerate input must fail open, never freeze a lead", () => {
  it("proceeds when there is no engagement on record", () => {
    expect(evaluateEngagementWindow(input({ lastEngagedAt: undefined })).defer).toBe(false);
    expect(evaluateEngagementWindow(input({ lastEngagedAt: null })).defer).toBe(false);
  });

  it("proceeds on an unparseable timestamp rather than holding forever", () => {
    // A corrupt value must not silently stop a lead ever being contacted.
    const result = evaluateEngagementWindow(input({ lastEngagedAt: "not-a-date" }));
    expect(result.defer).toBe(false);
    expect(result.reason).toMatch(/unreadable/i);
  });

  it("proceeds when the timestamp is in the future", () => {
    // Clock skew between instances, not engagement. Deferring on this would
    // hold the lead until the future caught up.
    const result = evaluateEngagementWindow(
      input({ lastEngagedAt: new Date(NOW.getTime() + 60 * 60_000).toISOString() })
    );
    expect(result.defer).toBe(false);
    expect(result.reason).toMatch(/future/i);
  });

  it("proceeds on a very old timestamp", () => {
    expect(
      evaluateEngagementWindow(input({ lastEngagedAt: "2020-01-01T00:00:00Z" })).defer
    ).toBe(false);
  });

  it("always gives a reason, whichever way it goes", () => {
    for (const v of [undefined, null, "not-a-date", NOW.toISOString()]) {
      expect(evaluateEngagementWindow(input({ lastEngagedAt: v })).reason.length).toBeGreaterThan(0);
    }
  });
});
