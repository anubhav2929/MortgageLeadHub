// Lead state machine — SPEC.md section 5. Pure function; any transition not
// in TRANSITIONS throws InvalidTransitionError.

import type { LeadState } from "@/domain/types";

export type LeadTransitionEvent =
  | "LEAD_CREATED"
  | "OUTREACH_ATTEMPTED"
  | "CONTACT_ANSWERED"
  | "MAX_ATTEMPTS_REACHED"
  | "CONVERSATION_COMPLETED"
  | "PACKAGE_READY"
  | "OFFICER_ASSIGNED"
  | "OFFICER_ACKNOWLEDGED"
  | "CADENCE_EXHAUSTED"
  | "OPT_OUT_RECEIVED"
  | "DNC_MATCH"
  | "COMPLAINT"
  | "WRONG_PARTY"
  | "OFFICER_TAKEOVER"
  | "MARKED_WON"
  | "MARKED_LOST";

export class InvalidTransitionError extends Error {
  constructor(from: LeadState, event: LeadTransitionEvent) {
    super(`Invalid transition: ${event} cannot be applied from state ${from}`);
    this.name = "InvalidTransitionError";
  }
}

const GLOBAL_EVENTS: LeadTransitionEvent[] = ["OPT_OUT_RECEIVED", "DNC_MATCH", "COMPLAINT", "WRONG_PARTY"];
const TERMINAL_STATES: LeadState[] = ["SUPPRESSED", "CLOSED_WON", "CLOSED_LOST"];

const TRANSITIONS: Partial<Record<LeadState, Partial<Record<LeadTransitionEvent, LeadState>>>> = {
  NEW: { OUTREACH_ATTEMPTED: "ATTEMPTING_CONTACT" },
  ATTEMPTING_CONTACT: {
    CONTACT_ANSWERED: "IN_CONVERSATION",
    MAX_ATTEMPTS_REACHED: "NURTURE",
  },
  IN_CONVERSATION: { CONVERSATION_COMPLETED: "QUALIFYING" },
  QUALIFYING: { PACKAGE_READY: "READY_FOR_HANDOFF" },
  READY_FOR_HANDOFF: { OFFICER_ASSIGNED: "ASSIGNED" },
  ASSIGNED: { OFFICER_ACKNOWLEDGED: "ACKNOWLEDGED" },
  NURTURE: { CADENCE_EXHAUSTED: "STALE" },
  ACKNOWLEDGED: { MARKED_WON: "CLOSED_WON", MARKED_LOST: "CLOSED_LOST" },
};

export function transition(from: LeadState, event: LeadTransitionEvent): LeadState {
  if (TERMINAL_STATES.includes(from)) throw new InvalidTransitionError(from, event);
  if (GLOBAL_EVENTS.includes(event)) return "SUPPRESSED";
  if (event === "OFFICER_TAKEOVER") return "ASSIGNED";

  const to = TRANSITIONS[from]?.[event];
  if (!to) throw new InvalidTransitionError(from, event);
  return to;
}

export const STATE_LABELS: Record<LeadState, string> = {
  NEW: "New",
  ATTEMPTING_CONTACT: "Attempting contact",
  IN_CONVERSATION: "In conversation",
  QUALIFYING: "Qualifying",
  READY_FOR_HANDOFF: "Ready for handoff",
  ASSIGNED: "Assigned",
  ACKNOWLEDGED: "Acknowledged",
  NURTURE: "Nurture",
  STALE: "Stale",
  SUPPRESSED: "Suppressed",
  CLOSED_WON: "Closed won",
  CLOSED_LOST: "Closed lost",
};

export const STATE_TONE: Record<LeadState, "neutral" | "primary" | "success" | "warning" | "danger" | "info" | "violet"> = {
  NEW: "info",
  ATTEMPTING_CONTACT: "primary",
  IN_CONVERSATION: "violet",
  QUALIFYING: "violet",
  READY_FOR_HANDOFF: "warning",
  ASSIGNED: "primary",
  ACKNOWLEDGED: "success",
  NURTURE: "neutral",
  STALE: "warning",
  SUPPRESSED: "danger",
  CLOSED_WON: "success",
  CLOSED_LOST: "neutral",
};
