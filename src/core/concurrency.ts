// Bounded-parallel iteration.
//
// Two hand-rolled worker pools existed before this: one in domain/actions.ts
// for AI assessment, one in adapters/leadDiscovery.ts for archive sweeps. Both
// solved the same problem for the same reason — sequential was too slow for a
// serverless timeout, unbounded Promise.all trips provider rate limits — and
// each would have to be fixed separately.

/**
 * Runs `fn` over `items` with at most `limit` in flight.
 *
 * Results stay index-aligned with the input, so callers can zip them back
 * together. A rejected `fn` rejects the whole call, matching Promise.all —
 * callers that need partial results catch inside `fn` and return a sentinel,
 * which is what the discovery sweep does so one bad subreddit costs only that
 * subreddit.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];

  const results = new Array<R>(items.length);
  let cursor = 0;

  // Math.max(1, …) so a caller passing 0 or a negative limit gets sequential
  // execution rather than spawning no workers and hanging forever.
  const workerCount = Math.max(1, Math.min(limit, items.length));

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await fn(items[index], index);
      }
    })
  );

  return results;
}
