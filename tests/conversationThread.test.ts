import { describe, expect, it } from "vitest";
import {
  buildConversationBrief,
  buildLeadThread,
  hasReplySince,
  lastOutboundChannel,
  repliedChannels,
} from "@/core/conversationThread";
import type { ContactAttempt, ConversationSession, Note } from "@/domain/types";

// The thread is a derived view over three separate stores. The behaviour
// worth protecting is de-duplication: a voice call exists as BOTH a
// ContactAttempt and a ConversationSession, and naively merging them shows
// every AI call twice — which then feeds a doubled history back into the
// model on the next touch.

function attempt(overrides: Partial<ContactAttempt> = {}): ContactAttempt {
  return {
    id: "att1",
    leadId: "lead1",
    channel: "SMS",
    direction: "OUTBOUND",
    idempotencyKey: "idem1",
    outcome: "SENT",
    attemptNumber: 1,
    scheduledFor: "2026-08-11T15:00:00Z",
    startedAt: "2026-08-11T15:00:00Z",
    body: "Hi, following up on your inquiry.",
    ...overrides,
  };
}

function conversation(overrides: Partial<ConversationSession> = {}): ConversationSession {
  return {
    id: "conv1",
    leadId: "lead1",
    contactAttemptId: "att1",
    promptVersionId: "p1",
    channel: "VOICE",
    status: "COMPLETED",
    startedAt: "2026-08-11T15:00:00Z",
    escalated: false,
    redactionApplied: false,
    transcript: [
      { turn: 1, role: "AGENT", text: "Hi, is now a good time?", at: "2026-08-11T15:00:10Z" },
      { turn: 2, role: "BORROWER", text: "Sure.", at: "2026-08-11T15:00:20Z" },
    ],
    ...overrides,
  };
}

function note(overrides: Partial<Note> = {}): Note {
  return {
    id: "note1",
    leadId: "lead1",
    authorId: "borrower",
    authorName: "Borrower (via email reply)",
    body: "I'm away until the 15th.",
    createdAt: "2026-08-11T16:00:00Z",
    ...overrides,
  };
}

describe("buildLeadThread — assembly", () => {
  it("returns an empty thread when there is nothing to show", () => {
    expect(buildLeadThread({ attempts: [], conversations: [], notes: [] })).toEqual([]);
  });

  it("orders messages chronologically across sources", () => {
    const thread = buildLeadThread({
      attempts: [attempt({ id: "a2", startedAt: "2026-08-11T17:00:00Z", body: "second" })],
      conversations: [],
      notes: [note({ createdAt: "2026-08-11T16:00:00Z", body: "first" })],
    });
    expect(thread.map((m) => m.text)).toEqual(["first", "second"]);
  });

  it("marks borrower notes as inbound and infers the channel from the source", () => {
    const thread = buildLeadThread({ attempts: [], conversations: [], notes: [note()] });
    expect(thread[0].direction).toBe("INBOUND");
    expect(thread[0].role).toBe("BORROWER");
    expect(thread[0].channel).toBe("EMAIL");
  });

  it("treats a status-page message as the portal channel", () => {
    const thread = buildLeadThread({
      attempts: [],
      conversations: [],
      notes: [note({ authorName: "Borrower (via status chat)" })],
    });
    expect(thread[0].channel).toBe("PORTAL");
  });

  it("excludes an officer's private note from the borrower conversation", () => {
    // Internal notes are not part of what was said TO the borrower, and must
    // never be fed back to the model as conversation history.
    const thread = buildLeadThread({
      attempts: [],
      conversations: [],
      notes: [note({ authorId: "user_officer_1", authorName: "Marcus Chen", body: "Internal: sounds motivated" })],
    });
    expect(thread).toEqual([]);
  });
});

describe("buildLeadThread — de-duplication", () => {
  it("shows a call's transcript instead of its attempt row, not both", () => {
    const thread = buildLeadThread({
      attempts: [attempt({ id: "att1", channel: "VOICE", body: "Call script here" })],
      conversations: [conversation({ contactAttemptId: "att1" })],
      notes: [],
    });
    expect(thread).toHaveLength(2); // two transcript turns
    expect(thread.map((m) => m.text)).toEqual(["Hi, is now a good time?", "Sure."]);
    expect(thread.some((m) => m.text === "Call script here")).toBe(false);
  });

  it("falls back to the attempt row when a call has no transcript", () => {
    const thread = buildLeadThread({
      attempts: [attempt({ id: "att1", channel: "VOICE", body: "" })],
      conversations: [conversation({ contactAttemptId: "att1", transcript: [] })],
      notes: [],
    });
    expect(thread).toHaveLength(1);
    expect(thread[0].text).toBe("Call placed.");
  });

  it("still includes a transcript whose attempt row is missing", () => {
    // A webhook can land before the attempt is linked; losing the transcript
    // entirely would be worse than showing it unattached.
    const thread = buildLeadThread({
      attempts: [],
      conversations: [conversation({ contactAttemptId: "orphaned" })],
      notes: [],
    });
    expect(thread).toHaveLength(2);
  });

  it("surfaces a blocked attempt rather than dropping it silently", () => {
    const thread = buildLeadThread({
      attempts: [attempt({ body: "", blockedReason: "QUIET_HOURS_LOCAL", outcome: "BLOCKED" })],
      conversations: [],
      notes: [],
    });
    expect(thread).toHaveLength(1);
    expect(thread[0].meta).toBe("blocked");
  });
});

describe("thread query helpers", () => {
  const thread = buildLeadThread({
    attempts: [attempt({ id: "a1", channel: "SMS", startedAt: "2026-08-11T15:00:00Z" })],
    conversations: [],
    notes: [note({ createdAt: "2026-08-11T16:00:00Z" })],
  });

  it("reports which channels the borrower replied on", () => {
    expect(repliedChannels(thread).has("EMAIL")).toBe(true);
    expect(repliedChannels(thread).has("SMS")).toBe(false);
  });

  it("reports the most recent outbound channel", () => {
    expect(lastOutboundChannel(thread)).toBe("SMS");
  });

  it("returns null when nothing has gone out", () => {
    expect(lastOutboundChannel([])).toBeNull();
  });

  it("detects a reply after a given moment", () => {
    expect(hasReplySince(thread, "2026-08-11T15:30:00Z")).toBe(true);
    expect(hasReplySince(thread, "2026-08-11T17:00:00Z")).toBe(false);
  });
});

describe("buildConversationBrief", () => {
  it("is empty for an empty thread", () => {
    expect(buildConversationBrief([])).toBe("");
  });

  it("labels each line with channel and speaker", () => {
    const brief = buildConversationBrief(
      buildLeadThread({ attempts: [attempt()], conversations: [], notes: [note()] })
    );
    expect(brief).toContain("[sms] Us:");
    expect(brief).toContain("[email] Borrower:");
  });

  it("keeps only the most recent messages", () => {
    const attempts = Array.from({ length: 20 }, (_, i) =>
      attempt({ id: `a${i}`, startedAt: `2026-08-11T${String(i).padStart(2, "0")}:00:00Z`, body: `message ${i}` })
    );
    const brief = buildConversationBrief(buildLeadThread({ attempts, conversations: [], notes: [] }), 5);
    expect(brief.split("\n")).toHaveLength(5);
    expect(brief).toContain("message 19");
    expect(brief).not.toContain("message 0");
  });

  it("truncates a long message so one outlier can't dominate the prompt", () => {
    const brief = buildConversationBrief(
      buildLeadThread({ attempts: [attempt({ body: "x".repeat(1000) })], conversations: [], notes: [] })
    );
    expect(brief).toContain("…");
    expect(brief.length).toBeLessThan(500);
  });
});

describe("the thread opens with the intake submission", () => {
  const intake = {
    submittedAt: "2026-08-01T10:00:00Z",
    intent: "CASH_OUT",
    goal: "CONSOLIDATE_DEBT",
    timeline: "ZERO_TO_THREE_MONTHS",
    stateCode: "TX",
    occupancy: "PRIMARY",
    estimatedValue: 540000,
    currentBalance: 310000,
    missedPayments: "NONE",
  };

  it("places the submission before everything else", () => {
    // Without this the tab opened on our outbound call, so the post-submit
    // chat read as a conversation with no beginning.
    const thread = buildLeadThread({
      attempts: [],
      conversations: [],
      notes: [
        {
          id: "n1",
          leadId: "l1",
          authorId: "borrower",
          authorName: "Borrower (portal)",
          body: "Actually my last name is spelled Whitfield.",
          createdAt: "2026-08-01T10:04:00Z",
        } as never,
      ],
      intake,
    });
    expect(thread[0].id).toBe("intake-submission");
    expect(thread[0].role).toBe("BORROWER");
    expect(thread[0].direction).toBe("INBOUND");
    expect(thread).toHaveLength(2);
  });

  it("reads as something a person said, not a record dump", () => {
    const [first] = buildLeadThread({ attempts: [], conversations: [], notes: [], intake });
    expect(first.text).toMatch(/cash-out refinance/i);
    expect(first.text).toMatch(/TX/);
    // Enum underscores must not leak into borrower-facing prose.
    expect(first.text).not.toMatch(/_/);
  });

  it("states 'no missed payments' explicitly rather than omitting it", () => {
    // Absence of the sentence is ambiguous — it could mean nobody asked.
    const [first] = buildLeadThread({ attempts: [], conversations: [], notes: [], intake });
    expect(first.text).toMatch(/haven't missed any/i);
  });

  it("computes equity when both figures are present", () => {
    const [first] = buildLeadThread({ attempts: [], conversations: [], notes: [], intake });
    expect(first.text).toMatch(/\$230,000 of equity/);
  });

  it("omits the intake message entirely when no summary is supplied", () => {
    // The channel router and AI brief pass no intake and must be unaffected.
    expect(buildLeadThread({ attempts: [], conversations: [], notes: [] })).toHaveLength(0);
  });
});

describe("enum values become readable prose", () => {
  const base = {
    submittedAt: "2026-08-01T10:00:00Z",
    intent: "REFINANCE",
    goal: "LOWER_PAYMENT",
    timeline: "1_3_MONTHS",
    stateCode: "TX",
  };

  it("renders a numeric range with a dash, not a gap", () => {
    // "my timeline is 1 3 months" reads as a typo in borrower-facing text.
    const [m] = buildLeadThread({ attempts: [], conversations: [], notes: [], intake: base });
    expect(m.text).toMatch(/1–3 months/);
    expect(m.text).not.toMatch(/1 3 months/);
  });

  it("spells out enums that have an established phrasing", () => {
    const [m] = buildLeadThread({
      attempts: [],
      conversations: [],
      notes: [],
      intake: { ...base, timeline: "ASAP", goal: "DEBT_CONSOLIDATION", intent: "CASH_OUT" },
    });
    expect(m.text).toMatch(/as soon as possible/);
    expect(m.text).toMatch(/simplify my monthly payments/);
    expect(m.text).toMatch(/cash-out refinance/);
  });
});

describe("the AI brief never loses why the borrower called", () => {
  const intake = {
    submittedAt: "2026-08-01T10:00:00Z",
    intent: "CASH_OUT",
    goal: "DEBT_CONSOLIDATION",
    timeline: "ASAP",
    stateCode: "TX",
    estimatedValue: 540000,
    currentBalance: 310000,
  };
  const chatter = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `n${i}`,
      leadId: "l1",
      authorId: "borrower",
      authorName: "Borrower (portal)",
      body: `Chat message ${i + 1}`,
      createdAt: new Date(Date.parse("2026-08-01T10:05:00Z") + i * 60_000).toISOString(),
    })) as never[];

  it("keeps the intake even when the thread is longer than the brief", () => {
    // A tail-slice drops the oldest message, and the intake IS the oldest —
    // so a chatty borrower would get called by an agent that knew this
    // morning's small talk but not that they want a cash-out refinance.
    const brief = buildConversationBrief(
      buildLeadThread({ attempts: [], conversations: [], notes: chatter(30), intake })
    );
    expect(brief).toMatch(/cash-out refinance/);
    expect(brief).toMatch(/\$230,000 of equity/);
  });

  it("still prefers recent messages for everything else", () => {
    const brief = buildConversationBrief(
      buildLeadThread({ attempts: [], conversations: [], notes: chatter(30), intake })
    );
    expect(brief).toMatch(/Chat message 30/);
    expect(brief).not.toMatch(/Chat message 1\b/);
  });

  it("respects the message budget rather than growing by one", () => {
    const brief = buildConversationBrief(
      buildLeadThread({ attempts: [], conversations: [], notes: chatter(30), intake }),
      12
    );
    expect(brief.split("\n")).toHaveLength(12);
  });

  it("is unchanged for threads with no intake summary", () => {
    const brief = buildConversationBrief(buildLeadThread({ attempts: [], conversations: [], notes: chatter(30) }), 5);
    expect(brief.split("\n")).toHaveLength(5);
    expect(brief).toMatch(/Chat message 30/);
  });
});
