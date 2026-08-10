import { describe, expect, it } from "vitest";
import { InvalidTransitionError, transition } from "@/core/stateMachine";
import type { LeadState } from "@/domain/types";

// The lead lifecycle is a closed state machine on purpose: an illegal
// transition throws rather than silently coercing, so a bug surfaces at the
// point of the mistake instead of as an impossible lead state discovered
// weeks later in a report.

describe("transition — the happy path", () => {
  it("walks a lead from intake to a closed win", () => {
    let state: LeadState = "NEW";
    state = transition(state, "OUTREACH_ATTEMPTED");
    expect(state).toBe("ATTEMPTING_CONTACT");
    state = transition(state, "CONTACT_ANSWERED");
    expect(state).toBe("IN_CONVERSATION");
    state = transition(state, "CONVERSATION_COMPLETED");
    expect(state).toBe("QUALIFYING");
    state = transition(state, "PACKAGE_READY");
    expect(state).toBe("READY_FOR_HANDOFF");
    state = transition(state, "OFFICER_ASSIGNED");
    expect(state).toBe("ASSIGNED");
    state = transition(state, "OFFICER_ACKNOWLEDGED");
    expect(state).toBe("ACKNOWLEDGED");
    state = transition(state, "MARKED_WON");
    expect(state).toBe("CLOSED_WON");
  });

  it("parks an unreachable lead in nurture, then stale", () => {
    let state = transition("ATTEMPTING_CONTACT", "MAX_ATTEMPTS_REACHED");
    expect(state).toBe("NURTURE");
    state = transition(state, "CADENCE_EXHAUSTED");
    expect(state).toBe("STALE");
  });
});

describe("transition — compliance events short-circuit everything", () => {
  it.each(["OPT_OUT_RECEIVED", "DNC_MATCH", "COMPLAINT", "WRONG_PARTY"] as const)(
    "%s suppresses the lead from any active state",
    (event) => {
      // These must not depend on where the lead happens to be. A borrower
      // saying STOP mid-conversation has to land in SUPPRESSED just as
      // reliably as one who says it after the first text.
      for (const from of ["NEW", "ATTEMPTING_CONTACT", "IN_CONVERSATION", "QUALIFYING", "ASSIGNED"] as LeadState[]) {
        expect(transition(from, event)).toBe("SUPPRESSED");
      }
    }
  );
});

describe("transition — officer takeover", () => {
  it("assigns from any active state", () => {
    expect(transition("NEW", "OFFICER_TAKEOVER")).toBe("ASSIGNED");
    expect(transition("NURTURE", "OFFICER_TAKEOVER")).toBe("ASSIGNED");
  });
});

describe("transition — illegal moves", () => {
  it.each(["CLOSED_WON", "CLOSED_LOST", "SUPPRESSED"] as LeadState[])(
    "refuses to move out of terminal state %s",
    (from) => {
      expect(() => transition(from, "OUTREACH_ATTEMPTED")).toThrow(InvalidTransitionError);
    }
  );

  it("refuses a compliance event on an already-terminal lead", () => {
    // Even OPT_OUT can't reopen a closed lead — terminal is terminal.
    expect(() => transition("CLOSED_WON", "OPT_OUT_RECEIVED")).toThrow(InvalidTransitionError);
  });

  it("refuses to skip stages", () => {
    expect(() => transition("NEW", "PACKAGE_READY")).toThrow(InvalidTransitionError);
    expect(() => transition("NEW", "MARKED_WON")).toThrow(InvalidTransitionError);
  });

  it("names both the state and the event in the error", () => {
    // The message is what an on-call engineer reads first.
    try {
      transition("NEW", "MARKED_WON");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidTransitionError);
      expect((err as Error).message).toContain("NEW");
      expect((err as Error).message).toContain("MARKED_WON");
    }
  });
});
