// What the environment banner says, decided as a pure function.
//
// The banner is a truthfulness surface: it is the one place the app tells a
// visitor whether what they are looking at is real. That makes a *stale* claim
// worse than no claim, and the old copy had become stale in a specific way —
// it said "synthetic data only" while lead discovery was reading live public
// posts by real people. It was reassuring and wrong.
//
// So the message is derived from capabilities rather than hardcoded, and the
// derivation lives here where it can be tested exhaustively.

export interface EnvironmentInput {
  hasSms: boolean;
  hasVoice: boolean;
  hasVoiceAgent: boolean;
  hasResend: boolean;
  /** Discovery reads a public archive and is live regardless of credentials. */
  hasLeadDiscovery: boolean;
}

export type EnvironmentLevel = "LIVE" | "PARTIAL" | "DEMO";

export interface EnvironmentDescription {
  level: EnvironmentLevel;
  /** Short prefix — "LIVE", "PARTIALLY LIVE", "DEMO". */
  label: string;
  message: string;
  liveChannels: string[];
  simulatedChannels: string[];
}

const OUTBOUND = [
  { key: "hasSms", label: "texts" },
  { key: "hasVoice", label: "calls" },
  { key: "hasVoiceAgent", label: "AI voice calls" },
  { key: "hasResend", label: "emails" },
] as const;

function list(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

export function describeEnvironment(input: EnvironmentInput): EnvironmentDescription {
  const liveChannels = OUTBOUND.filter((c) => input[c.key]).map((c) => c.label);
  const simulatedChannels = OUTBOUND.filter((c) => !input[c.key]).map((c) => c.label);

  // Named separately from the outbound channels because it is a different
  // kind of claim: discovery reads real data *in*, while the others send real
  // messages *out*. Conflating them is exactly how the old copy went wrong.
  const discoveryNote = input.hasLeadDiscovery
    ? " Lead discovery reads real public posts."
    : "";

  if (liveChannels.length === OUTBOUND.length) {
    return {
      level: "LIVE",
      label: "LIVE",
      message: "LIVE — this deployment sends real calls, texts, and emails to real people.",
      liveChannels,
      simulatedChannels,
    };
  }

  if (liveChannels.length > 0) {
    return {
      level: "PARTIAL",
      label: "PARTIALLY LIVE",
      // Naming both halves matters operationally: someone demoing needs to
      // know which button actually reaches a stranger's phone.
      message: `PARTIALLY LIVE — real ${list(liveChannels)} are sent. Simulated: ${list(simulatedChannels)}.${discoveryNote}`,
      liveChannels,
      simulatedChannels,
    };
  }

  return {
    level: "DEMO",
    label: "DEMO",
    message: `DEMO — no real calls, texts, or emails are sent.${discoveryNote}`,
    liveChannels,
    simulatedChannels,
  };
}

/**
 * Whether to render the banner. The admin's choice is always honoured.
 *
 * It is worth being explicit about why there is no "but not when LIVE"
 * exception here, because that was the tempting design. The banner is an
 * internal build-status affordance, not a consumer disclosure — it sits in the
 * root layout, so it renders on the public marketing pages too. A production
 * deployment that genuinely sends real messages is precisely the deployment
 * that should not be shouting "LIVE" at borrowers, and an override would make
 * that banner unremovable exactly when it is least appropriate.
 *
 * The hazard was never the banner's presence, it was its *claim*: the old copy
 * asserted "no real calls, texts, or emails are sent" from a hardcoded string
 * that could not go stale gracefully. describeEnvironment() derives that from
 * live capabilities instead, so the banner can no longer lie. Given that, who
 * sees it is a preference, and preferences belong to the admin.
 */
export function shouldShowBanner(_level: EnvironmentLevel, adminEnabled: boolean): boolean {
  return adminEnabled;
}
