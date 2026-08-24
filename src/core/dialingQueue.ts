import type { AttemptOutcome, DialingQueueItem, DialingSession } from "@/domain/types";

const TERMINAL_OUTCOMES = new Set<AttemptOutcome>(["ANSWERED", "NO_ANSWER", "BUSY", "VOICEMAIL", "FAILED", "BLOCKED", "UNDELIVERED"]);

export function callItemHasSettled(outcome?: AttemptOutcome, callStatus?: "QUEUED" | "RINGING" | "CONNECTED" | "ENDED"): boolean {
  // Conversation status is authoritative when a Vapi session exists: an
  // ANSWERED attempt may be written at pickup while the borrower is still on
  // the line. Starting the next call then would violate concurrency-one.
  if (callStatus) return callStatus === "ENDED";
  return Boolean(outcome && TERMINAL_OUTCOMES.has(outcome));
}

export function nextPendingDialItem(session: DialingSession, items: DialingQueueItem[]): DialingQueueItem | undefined {
  return items
    .filter((item) => item.sessionId === session.id && item.status === "PENDING")
    .sort((a, b) => a.position - b.position)[0];
}

export function dialingSessionProgress(items: DialingQueueItem[]) {
  const completed = items.filter((item) => ["COMPLETED", "BLOCKED", "FAILED", "SKIPPED"].includes(item.status)).length;
  return { completed, total: items.length, remaining: items.length - completed };
}
