// Remembers which provider events have already been applied.
//
// Both Telnyx and Vapi deliver at-least-once: a webhook can arrive twice
// because a response was slow, a retry raced the original, or the provider
// simply sent it again. Nothing in the handlers guarded against that, so a
// duplicated inbound SMS became two borrower messages and a duplicated
// transcript event became a repeated line — which then poisons the AI brief
// for the NEXT call, because the brief is built from the transcript.
//
// Deliberately in-memory and bounded rather than a database table. This is a
// short-horizon guard: duplicates arrive within seconds of the original, not
// hours later. Persisting it would add a write to the hottest path in the
// system for no additional protection, and a process restart losing the set
// only reopens a seconds-wide window.

interface Entry {
  seenAt: number;
}

const seen = new Map<string, Entry>();

/** Long enough to cover any realistic retry, short enough to stay small. */
export const IDEMPOTENCY_WINDOW_MS = 10 * 60_000;

/** Hard ceiling so a burst of unique events cannot grow this without bound. */
const MAX_ENTRIES = 5000;

function evict(now: number): void {
  for (const [key, entry] of seen) {
    if (now - entry.seenAt > IDEMPOTENCY_WINDOW_MS) seen.delete(key);
  }
  // Still too big after expiry: drop oldest-first. Map preserves insertion
  // order, so the first keys are the oldest.
  if (seen.size > MAX_ENTRIES) {
    const excess = seen.size - MAX_ENTRIES;
    let i = 0;
    for (const key of seen.keys()) {
      if (i++ >= excess) break;
      seen.delete(key);
    }
  }
}

/**
 * True if this event has already been applied. Marks it as seen either way.
 *
 * Callers should treat `true` as "acknowledge and do nothing" — never as an
 * error. A duplicate is normal provider behaviour, not a fault.
 */
export function alreadyProcessed(key: string, now = Date.now()): boolean {
  if (!key) return false; // No usable id — cannot dedupe, so do not pretend to.
  if (seen.has(key)) {
    // Expired entries are treated as unseen so a genuine later event with a
    // recycled id is not swallowed.
    if (now - seen.get(key)!.seenAt <= IDEMPOTENCY_WINDOW_MS) return true;
  }
  seen.set(key, { seenAt: now });
  // Evict AFTER inserting, or the ceiling is exceeded by exactly one on every
  // call once the map is full.
  evict(now);
  return false;
}

/** Visible for tests. */
export function processedCount(): number {
  return seen.size;
}

export function resetProcessed(): void {
  seen.clear();
}
