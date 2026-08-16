import { describe, expect, it } from "vitest";
import {
  classifyInboundMessage,
  looksLikeOptOutPhrase,
  mayResubscribe,
  HELP_REPLY_TEXT,
  OPT_OUT_CONFIRMATION_TEXT,
} from "@/core/inboundMessage";

// Two failure modes, both expensive and in opposite directions:
//   - Missing a real STOP keeps contacting someone who revoked consent. That
//     is a TCPA violation with statutory damages per message, and it revokes
//     the 10DLC registration the whole SMS channel depends on.
//   - Over-matching suppresses a live borrower who said "stop by on Tuesday".
// So: exact match acts, fuzzy match escalates to a human.

describe("carrier-mandated opt-out keywords", () => {
  it.each(["STOP", "stop", "Stop", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "REMOVE"])(
    "treats %s as an opt-out",
    (word) => {
      expect(classifyInboundMessage(word)).toBe("OPT_OUT");
    }
  );

  it("tolerates surrounding whitespace and punctuation", () => {
    expect(classifyInboundMessage("  STOP  ")).toBe("OPT_OUT");
    expect(classifyInboundMessage("STOP.")).toBe("OPT_OUT");
    expect(classifyInboundMessage("stop!")).toBe("OPT_OUT");
  });

  it("handles the spaced and hyphenated forms carriers also accept", () => {
    expect(classifyInboundMessage("opt out")).toBe("OPT_OUT");
    expect(classifyInboundMessage("OPT-OUT")).toBe("OPT_OUT");
  });
});

describe("opt-out must not over-match", () => {
  it("does not suppress a borrower using the word in a sentence", () => {
    // The single most expensive false positive: this is a live borrower
    // arranging a meeting, not revoking consent.
    expect(classifyInboundMessage("stop by tomorrow if you can")).toBe("MESSAGE");
    expect(classifyInboundMessage("Can you stop calling so early?")).toBe("MESSAGE");
    expect(classifyInboundMessage("I want to end my current loan")).toBe("MESSAGE");
  });

  it("treats an ordinary reply as a message", () => {
    expect(classifyInboundMessage("Yes I'm still interested, call me at 5")).toBe("MESSAGE");
  });
});

describe("resubscribe and help", () => {
  it.each(["START", "start", "UNSTOP", "YES", "SUBSCRIBE"])("treats %s as opt-in", (word) => {
    expect(classifyInboundMessage(word)).toBe("OPT_IN");
  });

  it.each(["HELP", "help", "INFO"])("treats %s as a help request", (word) => {
    expect(classifyInboundMessage(word)).toBe("HELP");
  });

  it("does not treat a sentence containing 'help' as a help request", () => {
    expect(classifyInboundMessage("I need help lowering my payment")).toBe("MESSAGE");
  });
});

describe("looksLikeOptOutPhrase — escalate, never auto-suppress", () => {
  it.each([
    "please stop calling me",
    "stop texting me",
    "don't call me again",
    "do not contact me",
    "take me off your list",
    "remove my number from your list",
    "not interested",
    "wrong number",
  ])("flags %s for human review", (phrase) => {
    expect(looksLikeOptOutPhrase(phrase)).toBe(true);
    // Critically, it is NOT classified as an automatic opt-out.
    expect(classifyInboundMessage(phrase)).toBe("MESSAGE");
  });

  it("does not flag ordinary conversation", () => {
    expect(looksLikeOptOutPhrase("Yes please call me tomorrow")).toBe(false);
    expect(looksLikeOptOutPhrase("What documents do you need?")).toBe(false);
  });
});

describe("mayResubscribe — a text cannot undo someone else's decision", () => {
  it("lets a borrower undo their own STOP", () => {
    expect(mayResubscribe("OPT_OUT_STOP")).toBe(true);
  });

  it.each(["DNC_LIST", "COMPLAINT", "LITIGATION", "WRONG_PARTY", "MANUAL"])(
    "refuses to lift a %s suppression",
    (reason) => {
      // These were placed by someone other than the borrower, for reasons a
      // borrower cannot unilaterally reverse. If an attacker could forge an
      // inbound START, this is what stops them re-enabling outreach.
      expect(mayResubscribe(reason)).toBe(false);
    }
  );
});

describe("carrier-required reply copy", () => {
  it("confirms the opt-out and states how to return", () => {
    expect(OPT_OUT_CONFIRMATION_TEXT).toMatch(/unsubscrib/i);
    expect(OPT_OUT_CONFIRMATION_TEXT).toMatch(/START/);
  });

  it("identifies the sender and repeats STOP, as carriers require", () => {
    expect(HELP_REPLY_TEXT).toMatch(/Equity Flow Group/);
    expect(HELP_REPLY_TEXT).toMatch(/STOP/);
  });

  it("keeps both replies inside a single SMS segment", () => {
    // A multi-segment compliance reply costs more and can be truncated by
    // some carriers, which would drop the required STOP instruction.
    expect(OPT_OUT_CONFIRMATION_TEXT.length).toBeLessThanOrEqual(160);
    expect(HELP_REPLY_TEXT.length).toBeLessThanOrEqual(160);
  });
});
