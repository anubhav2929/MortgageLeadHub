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
