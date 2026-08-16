// Settling calls the provider never told us about.
//
// A conversation is closed by exactly one thing: the provider's
// end-of-call-report. That is correct when it arrives, and it usually does.
// When it does not — a webhook secret changed mid-call, the endpoint was
// briefly unreachable, the provider dropped the event — the session stays
// IN_PROGRESS with no expiry.
//
// Hiding those from the board (an age filter on the query) was not enough and
// was arguably worse: the record still said a call was in progress, so
// pre-flight refused to place the next call to that borrower, permanently.
// One dropped webhook would quietly take a lead out of the pipeline for good.
//
// So they are settled, not hidden.

export interface StaleCallInput {
  /** QUEUED / RINGING / CONNECTED / ENDED — the provider's view. */
  callStatus?: "QUEUED" | "RINGING" | "CONNECTED" | "ENDED";
  startedAt: string;
  /** Last time any webhook touched this call. Falls back to startedAt. */
  lastSignalAt?: string;
  now: Date;
}

/**
 * A call that has not connected within this window never will. Carriers give
 * up ringing long before it, so anything still QUEUED or RINGING here is a
 * call whose closing event we simply did not receive.
 */
export const UNCONNECTED_TIMEOUT_MINUTES = 5;

/**
 * A connected call this long is implausible for this product — the agent is
 * qualifying a borrower, not running a webinar. Deliberately generous: reaping
 * a genuinely live call would cut off a real conversation, which is far worse
 * than a stale row lingering a little longer.
 */
export const CONNECTED_TIMEOUT_MINUTES = 30;

export interface StaleVerdict {
  stale: boolean;
  /** Recorded as the session's endedReason so the cause is not invented later. */
  reason?: string;
  /** True when the call never reached the borrower at all. */
  neverConnected?: boolean;
}

export function evaluateStaleCall(input: StaleCallInput): StaleVerdict {
  if (input.callStatus === "ENDED") return { stale: false };

  const anchor = input.lastSignalAt ?? input.startedAt;
  const t = new Date(anchor).getTime();

  // An unreadable timestamp cannot be reasoned about, and leaving the session
  // open forever is the outcome this module exists to prevent. Treat it as
  // stale so the record settles and the lead becomes contactable again.
  if (!Number.isFinite(t)) {
    return { stale: true, reason: "no-report-received-unreadable-timestamp", neverConnected: true };
  }

  const elapsedMinutes = (input.now.getTime() - t) / 60_000;

  // Clock skew between instances. Not stale, and not worth acting on.
  if (elapsedMinutes < 0) return { stale: false };

  const connected = input.callStatus === "CONNECTED";
  const limit = connected ? CONNECTED_TIMEOUT_MINUTES : UNCONNECTED_TIMEOUT_MINUTES;

  if (elapsedMinutes <= limit) return { stale: false };

  return {
    stale: true,
    reason: connected ? "no-report-received-after-connect" : "no-report-received-never-connected",
    neverConnected: !connected,
  };
}

/**
 * What outcome to record on the attempt when reaping.
 *
 * Deliberately conservative. We do not know what happened, so we do not claim
 * the borrower was reached — asserting ANSWERED would advance the lead to
 * IN_CONVERSATION and put a call nobody can produce a transcript for in front
 * of an officer as an opportunity.
 *
 * An attempt that already settled from its own webhook is left alone: the
 * report arrived for the attempt and only the session was missed.
 */
export function staleAttemptOutcome(neverConnected: boolean): "FAILED" | "NO_ANSWER" {
  // Never connected: nobody was reached, and it is not the borrower's doing.
  // Connected then silent: the borrower was on the line, so no-answer is the
  // honest reading rather than a system failure.
  return neverConnected ? "FAILED" : "NO_ANSWER";
}
