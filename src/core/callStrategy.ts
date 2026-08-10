// Which mechanism places an outbound call, and why. Pure, no I/O.
//
// The product has two very different things that were both called "a call":
//
//   VAPI_AGENT   — a real conversation. The borrower talks, the agent
//                  listens, qualifies, and hands off. Produces a transcript
//                  that feeds extraction and the unified conversation thread.
//                  This is the product.
//
//   ANNOUNCEMENT — Twilio dials the borrower and a TTS voice reads a fixed
//                  script at them. One-way. No transcript, no qualification,
//                  no way for the borrower to respond. This is a robocall.
//
// These were previously exposed as two peer buttons ("Call" and "AI call"),
// with the announcement as the default and the cadence's VOICE steps also
// routed through it. That is backwards: the announcement is strictly worse
// on every axis and should only ever run when the conversational agent is
// unavailable — and when it does run, the officer should be told why.

export type VoiceMechanism = "VAPI_AGENT" | "ANNOUNCEMENT" | "SIMULATED";

export interface VoiceCapabilities {
  /** Vapi API key, phone number id, and webhook secret all present. */
  hasVoiceAgent: boolean;
  /** Vapi key present but the number id and/or webhook secret are missing. */
  hasPartialVoiceAgent: boolean;
  /** Twilio account sid, auth token, and from-number all present. */
  hasTwilioVoice: boolean;
}

export interface VoiceStrategy {
  mechanism: VoiceMechanism;
  /** True when this is not the mechanism we would have preferred. */
  degraded: boolean;
  /** Operator-facing explanation. Shown in the dialer and the attempt log. */
  reason: string;
  /** What an admin should do to get the preferred mechanism, if anything. */
  remedy?: string;
}

/**
 * Pick the voice mechanism. Preference order is fixed and deliberate:
 * a real conversation beats a recorded announcement beats pretending.
 */
export function selectVoiceStrategy(caps: VoiceCapabilities): VoiceStrategy {
  if (caps.hasVoiceAgent) {
    return {
      mechanism: "VAPI_AGENT",
      degraded: false,
      reason: "Conversational AI agent — the borrower can talk, and the call is transcribed back into the lead.",
    };
  }

  if (caps.hasTwilioVoice) {
    return {
      mechanism: "ANNOUNCEMENT",
      degraded: true,
      reason:
        "One-way recorded announcement. The borrower cannot respond and nothing is transcribed, so this call will not qualify anyone.",
      remedy: caps.hasPartialVoiceAgent
        ? "Vapi is partly configured — add the phone number ID and webhook secret in Admin → Integrations to place real conversations instead."
        : "Configure Vapi in Admin → Integrations to place real conversations instead.",
    };
  }

  return {
    mechanism: "SIMULATED",
    degraded: true,
    reason: "No voice provider is connected, so nothing was dialled.",
    remedy: caps.hasPartialVoiceAgent
      ? "Vapi is partly configured — add the missing phone number ID and webhook secret in Admin → Integrations."
      : "Add Vapi (preferred) or Twilio credentials in Admin → Integrations.",
  };
}

/**
 * Whether this mechanism can actually qualify a lead.
 *
 * Used to decide whether to open a ConversationSession and whether the
 * cadence should expect a transcript. An announcement never produces one, so
 * treating it as a qualification attempt leaves a session permanently
 * IN_PROGRESS waiting for a webhook that will never arrive.
 */
export function producesConversation(mechanism: VoiceMechanism): boolean {
  return mechanism === "VAPI_AGENT";
}

/**
 * Should an automated cadence step place this call at all?
 *
 * A cadence VOICE step exists to have a conversation. Firing a one-way
 * robocall in its place spends money and a contact attempt on something that
 * cannot advance the lead — and repeated recorded calls to a consumer is
 * precisely the pattern TCPA complaints are made of. Better to let the
 * cadence route to SMS instead and leave voice for when the agent is live.
 */
export function shouldAutomateVoice(mechanism: VoiceMechanism): boolean {
  return mechanism === "VAPI_AGENT" || mechanism === "SIMULATED";
}
