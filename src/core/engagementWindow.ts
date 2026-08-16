// Should automated outreach hold off because the borrower is engaged right
// now? Pure, no I/O.
//
// Two reasons, and the second is the one that actually matters:
//
//  1. COST. Texting someone who is sitting on the page reading our chat is a
//     carrier segment spent on nothing. This is the rule from the Aug 11 call:
//     "once they leave the page, or it's been five minutes since they
//     interacted with the chatbot, then we take the cost and start contacting
//     them via SMS."
//
//  2. EXPERIENCE. A borrower mid-conversation in the chat who simultaneously
//     receives an automated text saying "following up on your inquiry" learns
//     that the two channels are not the same system. That undoes the single
//     thing this product is built to demonstrate.
//
// Deliberately applies to AUTOMATED steps only. A licensed officer who reads
// the live chat and decides to call is making an informed human decision, and
// nothing here should second-guess it.

export const DEFAULT_ENGAGEMENT_WINDOW_MINUTES = 5;

export interface EngagementInput {
  /** When the borrower last did something in the chat / status page. */
  lastEngagedAt?: string | null;
  now: Date;
  windowMinutes?: number;
  /** False for officer-initiated contact, which is never deferred. */
  isAutomated: boolean;
}

export interface EngagementDecision {
  defer: boolean;
  reason: string;
  /** When the window closes, so the cadence can retry rather than drop it. */
  retryAt?: Date;
}

/**
 * The borrower is "actively engaged" if they interacted inside the window.
 *
 * Note this defers *all* automated channels, not just SMS. Cost is only the
 * cheaper half of the argument — an automated call landing while someone is
 * typing in the chat is worse than the wasted spend.
 */
export function evaluateEngagementWindow(input: EngagementInput): EngagementDecision {
  if (!input.isAutomated) {
    return { defer: false, reason: "Manual officer action — never deferred." };
  }
  if (!input.lastEngagedAt) {
    return { defer: false, reason: "No live engagement on record." };
  }

  const last = new Date(input.lastEngagedAt).getTime();
  if (!Number.isFinite(last)) {
    // A corrupt timestamp must not silently freeze a lead's cadence forever.
    return { defer: false, reason: "Engagement timestamp unreadable — proceeding." };
  }

  const windowMs = (input.windowMinutes ?? DEFAULT_ENGAGEMENT_WINDOW_MINUTES) * 60_000;
  const elapsed = input.now.getTime() - last;

  // A timestamp in the future means clock skew, not engagement. Treat it as
  // stale rather than deferring indefinitely.
  if (elapsed < 0) {
    return { defer: false, reason: "Engagement timestamp is in the future — ignoring." };
  }

  if (elapsed < windowMs) {
    const remaining = Math.ceil((windowMs - elapsed) / 60_000);
    return {
      defer: true,
      reason: `Borrower is active in the chat — holding automated outreach for ~${remaining} more minute${remaining === 1 ? "" : "s"}.`,
      retryAt: new Date(last + windowMs),
    };
  }

  return { defer: false, reason: "Engagement window has lapsed — automated outreach may proceed." };
}
