// Lead discovery adapter — finds public forum posts expressing refinance or
// equity intent. Read-only and one-way: it surfaces candidates for a human to
// review and never creates a contactable CRM record on its own. That boundary
// is the whole safety model here (see domain/types.ts, DiscoveredSignal): the
// people found this way have given us no consent of any kind, so they must
// never be reachable by PolicyGate or the automated cadence.
//
// ---------------------------------------------------------------------------
// Retrieval: Arctic Shift, not the Reddit API
// ---------------------------------------------------------------------------
// Reddit's script-app registration at /prefs/apps is no longer reliably
// available, so OAuth credentials cannot be a hard dependency. We benchmarked
// the two community archives in Aug 2026:
//
//   PullPush      newest indexed content 452 days old; 502s under load
//   Arctic Shift  same-day content, no auth, 100 results/request
//
// Arctic Shift wins on the only axis that decides a lead-gen feature:
// freshness. PullPush is deliberately NOT wired in as a fallback — falling
// back to a year-stale archive would fill the review queue with dead leads
// while still looking like the feature worked, which is worse than returning
// nothing. If Arctic Shift is down, we say so.
//
// One real constraint: Arctic Shift rejects a bare `query` (it requires
// `subreddit` or `author`), so there is no internet-wide keyword search. We
// scope to a curated subreddit list instead and do keyword/intent filtering
// locally in core/discoveryQuery.ts. That is a better trade anyway — precision
// across a curated set of consumer finance subreddits beats recall across all
// of Reddit.
//
// Breadth, not depth: deep pagination (`before` cursor) was measured and times
// out on this archive, so coverage comes from sweeping MORE subreddits rather
// than paging further back through any one of them. Two non-Reddit sources
// were evaluated and rejected on the evidence — Stack Exchange's money site
// had no mortgage question newer than 53 days (our window is 14), and Hacker
// News is fresh but carries commentary *about* mortgages rather than people
// seeking one.
//
// Replaceability: everything vendor-specific is confined to fetchFromArctic()
// below. Swapping archives means writing one new function that returns
// RawCandidate[]; the scoring, dedup, and review pipeline are untouched.

import type { RawCandidate } from "@/core/discoveryQuery";
import { DISCOVERY_SUBREDDITS, MAX_SIGNAL_AGE_DAYS, selectSignals } from "@/core/discoveryQuery";
import { mapWithConcurrency } from "@/core/concurrency";

export interface RawSignal {
  source: "REDDIT";
  sourceUrl: string;
  subreddit: string;
  authorHandle: string;
  title: string;
  snippet: string;
  postedAt: string;
  intentScore: number;
  matchedKeywords: string[];
  kind: "POST" | "COMMENT";
  /** Human-readable origin, e.g. "r/Mortgages". Kept distinct from
   *  `subreddit` so a non-Reddit source can slot in without the UI having to
   *  special-case it. */
  sourceLabel: string;
}

export interface DiscoveryResult {
  signals: RawSignal[];
  simulated: boolean;
  /** Populated when the archive was unreachable, so the UI can say why. */
  error?: string;
  stats?: { fetched: number; kept: number; queries: number; sources: number };
}

const ARCTIC = "https://arctic-shift.photon-reddit.com/api";
const UA = "equityflowgroup-discovery/2.0";

const PER_REQUEST_LIMIT = 100;
const REQUEST_TIMEOUT_MS = 25_000;
const REQUEST_DELAY_MS = 800;
const MAX_RETRIES = 2;

/**
 * ---------------------------------------------------------------------------
 * Why there are no keyword queries here
 * ---------------------------------------------------------------------------
 * The obvious design — search each subreddit for each of our intent terms —
 * was measured and rejected. A 36-search sweep took 345 seconds and 19 of the
 * 36 requests failed, with the archive returning a blunt "Timeout. Maybe slow
 * down a bit". Full-text search is the expensive operation on this archive,
 * and on high-volume subreddits it simply does not complete.
 *
 * So we invert it: ask only for *recent posts per subreddit*, which is a
 * cheap time-indexed read, and do all keyword and intent filtering locally in
 * core/discoveryQuery.ts. That cut a 36-request sweep to one request per
 * subreddit, which is what makes a wide source list affordable at all.
 *
 * This is strictly better, not merely faster. Local filtering also catches
 * intent phrased in ways no term list anticipates — "can I pull money out of
 * my house to pay off cards?" contains none of our keywords as written, and a
 * server-side keyword search would never have returned it.
 */

/** Subreddits where comments are worth the extra request. */
const TOPICAL_SUBS = new Set(["Mortgages", "FirstTimeHomeBuyer", "HomeLoans"]);

interface ArcticPost {
  id: string;
  permalink?: string;
  author?: string;
  title?: string;
  selftext?: string;
  body?: string;
  subreddit?: string;
  created_utc: number;
  removed_by_category?: string | null;
  over_18?: boolean;
  link_title?: string;
}

async function fetchFromArctic(
  path: "posts" | "comments",
  params: Record<string, string>
): Promise<ArcticPost[]> {
  const qs = new URLSearchParams({ limit: String(PER_REQUEST_LIMIT), sort: "desc", ...params });

  // The archive answers overload with 422/500 and the text "Timeout. Maybe
  // slow down a bit" — an explicitly retryable condition, not a bad request.
  // Backing off and retrying recovers most of them.
  let lastError = "";
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    if (attempt > 0) await sleep(1500 * attempt);
    try {
      const res = await fetch(`${ARCTIC}/${path}/search?${qs}`, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const json = (await res.json().catch(() => ({}))) as { data?: ArcticPost[] | null; error?: string };
      if (res.ok && !json.error) return json.data ?? [];
      lastError = json.error ?? `HTTP ${res.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  throw new Error(`Arctic Shift ${path}: ${lastError}`);
}

function toCandidate(raw: ArcticPost, kind: "POST" | "COMMENT"): RawCandidate | null {
  const author = raw.author ?? "";
  const permalink = raw.permalink;
  if (!permalink || !author) return null;
  // Removed or moderator-deleted content cannot be replied to and often has
  // an empty body, so it would score as noise anyway.
  if (raw.removed_by_category) return null;

  const title = raw.title ?? raw.link_title ?? "";
  const body = raw.selftext ?? raw.body ?? "";
  if (body === "[removed]" || body === "[deleted]") return null;

  return {
    sourceUrl: `https://www.reddit.com${permalink}`,
    subreddit: raw.subreddit ?? "",
    authorHandle: `u/${author}`,
    title: title || body.slice(0, 80),
    body,
    postedAt: new Date(raw.created_utc * 1000).toISOString(),
    kind,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * @param query optional operator-supplied keyword; when absent we run the
 *   standard expansion from core/discoveryQuery.ts.
 */
export async function searchForSignals(query?: string): Promise<DiscoveryResult> {
  const candidates: RawCandidate[] = [];
  const failures: string[] = [];
  let queries = 0;

  /**
   * Each request is isolated. An early version let one failure escape the
   * loop, and a single 422 on r/RealEstate cut a 40-search sweep down to 6 —
   * silently, since the partial result still looked like a successful run.
   * Sources degrade independently; one bad subreddit must cost us that
   * subreddit and nothing else.
   */
  const collect = async (
    path: "posts" | "comments",
    params: Record<string, string>,
    kind: "POST" | "COMMENT"
  ) => {
    queries += 1;
    try {
      for (const raw of await fetchFromArctic(path, params)) {
        const c = toCandidate(raw, kind);
        if (c) candidates.push(c);
      }
    } catch (err) {
      const label = `${params.subreddit}${params.query ? `/"${params.query}"` : ""}`;
      failures.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
    }
    await sleep(REQUEST_DELAY_MS);
  };

  // Only pull the window we would actually keep. Anything older is discarded
  // by the freshness rule anyway, so fetching it wastes the archive's time
  // and ours.
  const after = String(Math.floor((Date.now() - MAX_SIGNAL_AGE_DAYS * 86_400_000) / 1000));

  // Sequentially, one request per subreddit across a 17-source list took 104
  // seconds — past a serverless function's ceiling, so discovery would work
  // locally and time out in production.
  //
  // Modest concurrency is safe *here* specifically because these are cheap
  // time-indexed reads. The earlier rate-limit failures came from expensive
  // full-text scans, which is a different workload; the per-request retry and
  // backoff in fetchFromArctic() remains the safety net either way. Kept
  // deliberately low — the goal is to fit the budget, not to extract maximum
  // throughput from someone else's free archive.
  const SOURCE_CONCURRENCY = 4;

  await mapWithConcurrency(DISCOVERY_SUBREDDITS, SOURCE_CONCURRENCY, async ({ name }) => {
    // An operator-typed keyword is the one case we still pay for a
    // server-side search: one deliberate request per subreddit, not a 36-way
    // automated sweep, and the operator is waiting on a specific answer.
    const params: Record<string, string> = { subreddit: name, after };
    if (query) params.query = query;

    await collect("posts", params, "POST");

    // Comments only for the topical subs — a mortgage question buried in a
    // r/personalfinance comment thread is real, but too sparse to justify
    // doubling the request budget.
    if (TOPICAL_SUBS.has(name)) {
      await collect("comments", { subreddit: name, after }, "COMMENT");
    }
  });

  if (failures.length > 0) {
    console.warn(`[discovery] ${failures.length}/${queries} searches failed:`, failures.join("; "));
  }
  // Only a total wipeout is an error. Partial results are genuinely useful,
  // but the caller is told so it can say "results may be incomplete" instead
  // of implying a clean sweep.
  if (candidates.length === 0) {
    return {
      signals: [],
      simulated: false,
      error: failures.length > 0 ? failures[0] : undefined,
      stats: { fetched: 0, kept: 0, queries, sources: DISCOVERY_SUBREDDITS.length },
    };
  }

  const selected = selectSignals(candidates, new Date());

  return {
    signals: selected.map((s) => ({
      source: "REDDIT" as const,
      sourceUrl: s.sourceUrl,
      subreddit: s.subreddit,
      authorHandle: s.authorHandle,
      title: s.title,
      // The full post text, not a summary — an officer replying in-thread
      // needs the borrower's own words, and a generated précis loses exactly
      // the details (rate, balance, timeline) that make the reply useful.
      snippet: s.body.slice(0, 2000) || s.title,
      postedAt: s.postedAt,
      intentScore: s.intentScore,
      matchedKeywords: s.matchedKeywords,
      kind: s.kind,
      sourceLabel: `r/${s.subreddit}`,
    })),
    simulated: false,
    error: failures.length > 0 ? `${failures.length} of ${queries} searches failed` : undefined,
    stats: { fetched: candidates.length, kept: selected.length, queries, sources: DISCOVERY_SUBREDDITS.length },
  };
}
