// Can this channel actually deliver right now?
//
// Distinct from PolicyGate, which asks whether we are ALLOWED to contact
// someone (consent, suppression, quiet hours, caps). This asks whether the
// message would physically leave the building.
//
// The bug this exists to prevent: an unconfigured channel does not fail. The
// adapter logs the message, returns success with `simulated: true`, and the
// caller records outcome SENT, consumes an attempt, and emits
// OUTREACH_ATTEMPTED — which is what the cadence counts to decide the next
// step. So on a deployment with, say, no email key, a six-step cadence would
// march a lead through its email steps, exhaust the schedule, and drop them
// into NURTURE having received nothing. The lead looks fully worked and is
// unreachable again, and fixing the key later does not bring them back.
//
// Manual sends deliberately still simulate — that is what makes the product
// demoable without credentials, and a person clicking Send is watching the
// result. Automation has nobody watching.

export type ReadinessChannel = "VOICE" | "SMS" | "EMAIL";

export interface ChannelReadinessInput {
  channel: ReadinessChannel;
  hasSms: boolean;
  hasEmail: boolean;
  /** A conversational agent — the only voice mechanism the cadence will use. */
  hasVoiceAgent: boolean;
  /** False for a person clicking Call/Text/Email. */
  isAutomated: boolean;
}

export interface ChannelReadinessDecision {
  /** True when the send may proceed. */
  ready: boolean;
  /** Why not — written to the log so a held step is explainable. */
  reason?: string;
  /**
   * Whether to hold the step for later rather than count it as done.
   *
   * Always true when not ready: an unconfigured channel is a fault on our
   * side, and a lead must never lose a cadence step to it. Holding means the
   * step fires for real once the credential is added, days later if need be.
   */
  hold?: boolean;
}

const READY: ChannelReadinessDecision = { ready: true };

export function evaluateChannelReadiness(input: ChannelReadinessInput): ChannelReadinessDecision {
  // A person clicking Send is watching what happens and is told the result is
  // simulated. Nothing to protect them from.
  if (!input.isAutomated) return READY;

  switch (input.channel) {
    case "SMS":
      return input.hasSms
        ? READY
        : { ready: false, hold: true, reason: "No SMS provider is connected — the text would not leave the server.", };
    case "EMAIL":
      return input.hasEmail
        ? READY
        : { ready: false, hold: true, reason: "No email provider is connected — the message would not leave the server." };
    case "VOICE":
      return input.hasVoiceAgent
        ? READY
        : { ready: false, hold: true, reason: "No conversational voice agent is connected — nothing would be dialled." };
  }
}

/**
 * Whether ANY automated channel can currently deliver.
 *
 * Used to distinguish "this lead's next step is on a dead channel" from
 * "nothing works at all". The second is an operator emergency and should read
 * as one rather than as thousands of individually held steps.
 */
export function anyChannelReady(input: Omit<ChannelReadinessInput, "channel" | "isAutomated">): boolean {
  return input.hasSms || input.hasEmail || input.hasVoiceAgent;
}
