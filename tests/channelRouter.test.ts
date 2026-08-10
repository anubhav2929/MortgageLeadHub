import { describe, expect, it } from "vitest";
import { describeRoute, selectBestChannel } from "@/core/channelRouter";
import type { ThreadMessage } from "@/core/conversationThread";
import type { Channel } from "@/domain/types";

// The router decides which channel an automated touch goes out on. It must
// never widen what is permitted — consent is decided upstream by PolicyGate
// and passed in as allowedChannels — and its reasoning has to stay
// explainable, because "why did the system call this person?" is a question
// with regulatory weight.

function msg(overrides: Partial<ThreadMessage>): ThreadMessage {
  return {
    id: "m1",
    at: "2026-08-11T15:00:00Z",
    channel: "SMS",
    direction: "OUTBOUND",
    role: "AGENT",
    text: "hello",
    ...overrides,
  };
}

const ALL: Channel[] = ["SMS", "VOICE", "EMAIL"];

function route(overrides: Partial<Parameters<typeof selectBestChannel>[0]> = {}) {
  return selectBestChannel({
    allowedChannels: ALL,
    thread: [],
    localHour: 14,
    leadScore: 50,
    hotLeadThreshold: 80,
    ...overrides,
  });
}

describe("selectBestChannel — consent is an absolute boundary", () => {
  it("never returns a channel outside allowedChannels", () => {
    const result = route({ allowedChannels: ["EMAIL"] });
    expect(result.channel).toBe("EMAIL");
  });

  it("returns null with an explanation when nothing is permitted", () => {
    const result = route({ allowedChannels: [] });
    expect(result.channel).toBeNull();
    expect(result.reasons[0]).toMatch(/permitted/i);
  });

  it("cannot be pulled outside consent by a strong preference signal", () => {
    // Borrower replied on SMS and asked for SMS, but SMS is not permitted
    // right now. The router must still not choose it.
    const result = route({
      allowedChannels: ["EMAIL"],
      statedPreference: "SMS",
      thread: [msg({ direction: "INBOUND", role: "BORROWER", channel: "SMS" })],
    });
    expect(result.channel).toBe("EMAIL");
  });
});

describe("selectBestChannel — ranking signals", () => {
  it("prefers a channel the borrower has actually replied on", () => {
    const result = route({
      thread: [msg({ direction: "INBOUND", role: "BORROWER", channel: "EMAIL" })],
    });
    expect(result.channel).toBe("EMAIL");
    expect(result.reasons.join(" ")).toMatch(/replied/i);
  });

  it("honours an explicitly stated preference", () => {
    const result = route({ statedPreference: "EMAIL" });
    expect(result.channel).toBe("EMAIL");
    expect(result.reasons.join(" ")).toMatch(/asked for/i);
  });

  it("ranks a demonstrated reply above a stated preference", () => {
    // What someone did beats what they said they'd prefer.
    const result = route({
      statedPreference: "VOICE",
      thread: [msg({ direction: "INBOUND", role: "BORROWER", channel: "EMAIL" })],
    });
    expect(result.channel).toBe("EMAIL");
  });

  it("avoids repeating a channel that went unanswered", () => {
    const result = route({
      thread: [msg({ direction: "OUTBOUND", channel: "SMS" })],
    });
    expect(result.channel).not.toBe("SMS");
    expect(result.scores.SMS).toBeLessThan(0);
  });

  it("keeps using a channel that got a reply, even if it was last used", () => {
    // The "don't repeat" penalty must not fire on a channel that is working.
    const result = route({
      thread: [
        msg({ id: "a", direction: "OUTBOUND", channel: "SMS" }),
        msg({ id: "b", at: "2026-08-11T15:05:00Z", direction: "INBOUND", role: "BORROWER", channel: "SMS" }),
      ],
    });
    expect(result.channel).toBe("SMS");
    expect(result.scores.SMS).toBeGreaterThan(0);
  });
});

describe("selectBestChannel — time of day", () => {
  it("prefers an async channel late at night", () => {
    const result = route({ localHour: 22, allowedChannels: ["VOICE", "EMAIL"] });
    expect(result.channel).toBe("EMAIL");
    expect(result.reasons.join(" ")).toMatch(/late/i);
  });

  it("prefers an async channel early in the morning", () => {
    const result = route({ localHour: 6, allowedChannels: ["VOICE", "SMS"] });
    expect(result.channel).toBe("SMS");
  });

  it("does not apply the late-hour bonus during business hours", () => {
    const result = route({ localHour: 14, allowedChannels: ["SMS"] });
    expect(result.reasons.join(" ")).not.toMatch(/late/i);
  });
});

describe("selectBestChannel — cost control", () => {
  it("spends a voice call on a hot lead", () => {
    const result = route({ leadScore: 90, hotLeadThreshold: 80, allowedChannels: ["VOICE", "EMAIL"] });
    expect(result.channel).toBe("VOICE");
    expect(result.reasons.join(" ")).toMatch(/live call/i);
  });

  it("does not spend a voice call on a cold lead", () => {
    // Voice is by far the most expensive touch; without this the router
    // would burn AI minutes on leads that don't justify them.
    const result = route({ leadScore: 20, hotLeadThreshold: 80, allowedChannels: ["VOICE", "EMAIL"] });
    expect(result.reasons.join(" ")).not.toMatch(/live call/i);
  });
});

describe("selectBestChannel — determinism and explainability", () => {
  it("returns the same channel for identical input", () => {
    const a = route({ statedPreference: "EMAIL" });
    const b = route({ statedPreference: "EMAIL" });
    expect(a.channel).toBe(b.channel);
  });

  it("breaks ties on caller-supplied order rather than arbitrarily", () => {
    expect(route({ allowedChannels: ["EMAIL", "SMS", "VOICE"] }).channel).toBe("EMAIL");
    expect(route({ allowedChannels: ["SMS", "EMAIL", "VOICE"] }).channel).toBe("SMS");
  });

  it("always gives a non-empty reason for its choice", () => {
    const result = route();
    expect(result.reasons.length).toBeGreaterThan(0);
    expect(result.reasons[0].length).toBeGreaterThan(0);
  });

  it("scores every permitted channel so a reviewer can see the runner-up", () => {
    const result = route();
    expect(Object.keys(result.scores).sort()).toEqual(["EMAIL", "SMS", "VOICE"]);
  });
});

describe("describeRoute", () => {
  it("produces a readable sentence naming the channel", () => {
    const text = describeRoute(route({ statedPreference: "EMAIL" }));
    expect(text).toMatch(/^Chose email/);
    expect(text.endsWith(".")).toBe(true);
  });

  it("explains itself when no channel is available", () => {
    expect(describeRoute(route({ allowedChannels: [] }))).toMatch(/permitted/i);
  });
});
