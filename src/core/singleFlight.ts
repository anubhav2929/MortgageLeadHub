// Runs an async job at most once at a time, process-wide.
//
// The call board polls every three seconds, from every open tab, for every
// signed-in user. Each of those reads was kicking off a reconcile+reap pass
// that mutates shared state and writes the store. With two tabs open, two
// passes interleave: both read the same conversation, both decide, and the
// slower write wins. That is how a call that was mid-update reverted, and how
// a call that had just been confirmed alive got reaped anyway.
//
// Concurrent callers here do not queue — they join the pass already running
// and receive its result. Queueing would be worse: ten tabs would produce ten
// sequential passes, each one re-doing work the last had just finished.

const inFlight = new Map<string, Promise<unknown>>();

export function singleFlight<T>(key: string, job: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;

  const promise = job().finally(() => {
    // Cleared in `finally` so a thrown job cannot wedge the key forever —
    // a permanently-stuck reconciler would freeze the board's state at
    // whatever it was when the first failure happened.
    inFlight.delete(key);
  });

  inFlight.set(key, promise);
  return promise;
}

/** Visible for tests and diagnostics. */
export function inFlightCount(): number {
  return inFlight.size;
}
