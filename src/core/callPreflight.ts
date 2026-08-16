// Refuse calls that cannot succeed, before they are placed.
//
// Most "call failures" in this system were never failures of the call — they
// were calls that should not have been attempted. A missing phone number, a
// provider that is not configured, a second call to someone already on the
// line: each of those reached the provider, was rejected, consumed an attempt
// from the lead's budget, and left a red row for an operator to interpret.
//
// The cheapest failure is the one that never leaves the building. Everything
// checkable locally is checked here, so the errors that do reach the call log
// are genuinely about the call — a busy line, a voicemail, a real fault —
// rather than about our own configuration.
//
// Pure and I/O-free. PolicyGate still runs separately and owns consent,
// suppression, quiet hours and attempt caps; this covers the mechanical
// preconditions PolicyGate has no opinion about.

export type PreflightBlocker =
  | "NO_PHONE_NUMBER"
  | "MALFORMED_PHONE_NUMBER"
  | "NO_VOICE_PROVIDER"
  | "ALREADY_ON_A_CALL"
  | "PROVIDER_MISCONFIGURED";

export interface PreflightInput {
  phoneE164?: string;
  /** Vapi fully configured — key, phone number id, webhook secret. */
  hasVoiceAgent: boolean;
  /** Announcement calling available as a fallback. */
  hasAnnouncementVoice: boolean;
  /** A conversation for this lead that is still open. */
  hasLiveCall: boolean;
  /** An unresolved CONFIGURATION-class failure on the voice channel. */
  providerMisconfigured?: boolean;
  /** Manual officer action bypasses the "already on a call" guard — an
   *  officer may deliberately take over. */
  isAutomated: boolean;
}

export interface PreflightDecision {
  allowed: boolean;
  blocker?: PreflightBlocker;
  /** Shown to the person or written to the attempt log. */
  reason?: string;
  /** What to do about it. */
  remedy?: string;
}

const ALLOW: PreflightDecision = { allowed: true };

/** E.164: a plus, a non-zero country digit, then up to 14 more. Deliberately
 *  strict — a number the provider will reject is better caught here, where the
 *  message can name the field, than as an opaque 400 three seconds later. */
const E164 = /^\+[1-9]\d{7,14}$/;

export function evaluateCallPreflight(input: PreflightInput): PreflightDecision {
  if (!input.phoneE164 || !input.phoneE164.trim()) {
    return {
      allowed: false,
      blocker: "NO_PHONE_NUMBER",
      reason: "This lead has no phone number on file.",
      remedy: "Add a number on the lead before calling.",
    };
  }

  if (!E164.test(input.phoneE164.trim())) {
    return {
      allowed: false,
      blocker: "MALFORMED_PHONE_NUMBER",
      reason: `"${input.phoneE164}" is not a valid E.164 number.`,
      remedy: "Correct the number on the lead — it must start with + and the country code.",
    };
  }

  // Checked before provider availability: a known-bad credential produces the
  // same failure on every lead, and dialling into it just multiplies the noise
  // an administrator has to read through.
  if (input.providerMisconfigured) {
    return {
      allowed: false,
      blocker: "PROVIDER_MISCONFIGURED",
      reason: "The voice provider rejected the last call for a configuration reason.",
      remedy: "Resolve the integration alert in Admin → Integrations, then try again.",
    };
  }

  if (!input.hasVoiceAgent && !input.hasAnnouncementVoice) {
    return {
      allowed: false,
      blocker: "NO_VOICE_PROVIDER",
      reason: "No voice provider is connected, so nothing would be dialled.",
      remedy: "Add Vapi in Admin → Integrations.",
    };
  }

  // Only automated outreach is blocked. An officer watching a live call and
  // deciding to call the borrower back is making an informed choice; the
  // cadence firing a second call into an active conversation is not.
  if (input.isAutomated && input.hasLiveCall) {
    return {
      allowed: false,
      blocker: "ALREADY_ON_A_CALL",
      reason: "A call with this borrower is already in progress.",
      remedy: "The cadence will retry once the current call ends.",
    };
  }

  return ALLOW;
}

/**
 * Whether a blocked call should consume one of the lead's daily attempts.
 *
 * Only if the borrower was genuinely unreachable. Our own misconfiguration
 * must never spend a lead's contact budget — otherwise a bad API key quietly
 * exhausts every lead's cadence and drops them all into NURTURE having never
 * been called once, and fixing the key does not bring them back.
 */
export function consumesAttempt(blocker: PreflightBlocker): boolean {
  switch (blocker) {
    case "NO_PHONE_NUMBER":
    case "MALFORMED_PHONE_NUMBER":
      // Bad data on the lead. Real, and worth a task, but it is not a contact
      // attempt because nothing was dialled.
      return false;
    case "NO_VOICE_PROVIDER":
    case "PROVIDER_MISCONFIGURED":
    case "ALREADY_ON_A_CALL":
      return false;
  }
}
