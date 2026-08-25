// Lead-discovery query expansion, intent scoring, and freshness rules.
//
// Pure by design (no I/O) so the judgement calls below — what counts as buying
// intent, what counts as noise, how old is too old — are unit-testable without
// hitting a live archive. The retrieval half lives in adapters/leadDiscovery.ts.
//
// Context for the freshness rules: we benchmarked two Reddit archives in
// Aug 2026. PullPush's newest indexed content was 452 days old; Arctic Shift
// was same-day. That is the whole reason MAX_SIGNAL_AGE_DAYS exists as an
// enforced filter rather than a sort preference — a stale archive silently
// filling the review queue with year-old posts is worse than an empty queue,
// because it *looks* like it is working.

export interface RawCandidate {
  sourceUrl: string;
  subreddit: string;
  authorHandle: string;
  title: string;
  body: string;
  postedAt: string;
  /** A comment carries different intent weight than a top-level post. */
  kind: "POST" | "COMMENT";
}

export interface ScoredCandidate extends RawCandidate {
  intentScore: number;
  matchedKeywords: string[];
  rejectedReason?: string;
}

/**
 * Anything older than this is dropped outright, never queued for review.
 * A mortgage question from last year has almost certainly resolved — the
 * person refinanced, or gave up. Contacting them reads as surveillance
 * rather than service, and it wastes the reviewer's attention, which is the
 * scarcest resource in this whole loop.
 */
export const MAX_SIGNAL_AGE_DAYS = 14;

/**
 * Subreddits where mortgage intent is genuinely expressed by consumers.
 *
 * Deliberately excludes r/RealEstateInvesting and the landlord subs: those
 * are commercial operators, not retail borrowers, and they poison precision.
 * Weight nudges the score — a question in r/Mortgages is far more likely to
 * be a real borrower than the same words in r/personalfinance.
 */
export const DISCOVERY_SUBREDDITS: { name: string; weight: number }[] = [
  // Core — mortgage is the subject, not a passing mention.
  { name: "Mortgages", weight: 1.0 },
  { name: "FirstTimeHomeBuyer", weight: 1.0 },
  { name: "HomeLoans", weight: 1.0 },

  // Adjacent — buying, owning, and the money questions that come with it.
  { name: "RealEstate", weight: 0.8 },
  { name: "RealEstateAdvice", weight: 0.8 },
  { name: "homeowners", weight: 0.8 },
  { name: "Home", weight: 0.6 },

  // VA loans are a large, well-served product and these two are where
  // eligible borrowers actually ask about them.
  { name: "MilitaryFinance", weight: 0.8 },
  { name: "VeteransBenefits", weight: 0.7 },

  // Personal finance — lower density, high absolute volume. The balance-payoff
  // subs matter specifically because cash-out and consolidation questions
  // surface there before they ever reach a mortgage sub.
  { name: "personalfinance", weight: 0.7 },
  { name: "DaveRamsey", weight: 0.7 },
  { name: "povertyfinance", weight: 0.6 },
  { name: "Bogleheads", weight: 0.6 },
  { name: "financialindependence", weight: 0.5 },
  { name: "creditrepair", weight: 0.6 },
  { name: "Frugal", weight: 0.4 },

  // Renovation funding is a HELOC conversation that has not been named as one
  // yet, which is precisely when it is worth reaching.
  { name: "homeimprovement", weight: 0.5 },

  // Deliberately NOT included: r/realtors and the investor subs. They carry
  // heavy mortgage vocabulary and almost no retail borrowers — they are the
  // industry talking to itself, which is the exact noise NEGATIVE_MARKERS
  // exists to reject. Adding them would raise volume and lower precision, and
  // precision is what makes the review queue worth opening.
];

/**
 * Query terms sent to the archive, tiered by how strongly each implies an
 * active transaction rather than idle curiosity.
 */
export const QUERY_TERMS = {
  /** Naming the product is the strongest signal short of asking for a lender. */
  primary: [
    "refinance",
    "cash out refi",
    "HELOC",
    "home equity loan",
    "mortgage rate",
    "second mortgage",
  ],
  secondary: [
    "home loan",
    "pre approval",
    "loan estimate",
    "closing costs",
    "PMI removal",
    "debt consolidation",
  ],
} as const;

/** Phrases that indicate someone is *acting*, not reading. */
const ACTION_PHRASES = [
  "should i refinance",
  "worth refinancing",
  "looking to refinance",
  "trying to refinance",
  "want to refinance",
  "thinking about refinancing",
  "recommend a lender",
  "which lender",
  "best lender",
  "shopping for",
  "getting quotes",
  "loan estimate",
  "pre approval",
  "preapproval",
  "how much can i borrow",
  "tap into equity",
  "pull equity",
  "use my equity",
  "lower my payment",
  "lower my rate",
  "consolidate debt",
];

/**
 * Contexts where the vocabulary matches but the person is not a prospect.
 * Without these, "refinance" pulls in press releases, brokers advertising,
 * and news commentary — which is exactly what made the naive keyword search
 * unusable.
 */
const NEGATIVE_MARKERS = [
  "dm me",
  "pm me",
  "i am a loan officer",
  "i'm a loan officer",
  "as a mortgage broker",
  "as a realtor",
  "my clients",
  "nmls #",
  "press release",
  "earnings",
  "arranges $",
  "commercial property",
  "apartment complex",
  "our brokerage",
  "hiring",
  "not financial advice, but i lend",
];

/** Countries we cannot originate in — the vocabulary overlaps heavily. */
const OUT_OF_MARKET = [
  "canada",
  "ontario",
  "toronto",
  "alberta",
  "uk",
  "united kingdom",
  "australia",
  "new zealand",
  "ireland",
  "£",
  "cad",
  "building society",
  "stamp duty",
  "offset mortgage",
];

/**
 * Stable identity for a candidate across repeated runs and across the two
 * archives. Reddit permalinks are the one field both sources agree on, but
 * they arrive with inconsistent trailing slashes, query strings, and
 * www/old/np host variants — so normalise before comparing or every run
 * re-adds the same post.
 */
export function dedupeKey(sourceUrl: string): string {
  return sourceUrl
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^(www\.|old\.|np\.|new\.)/, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "");
}

export function ageInDays(postedAt: string, now: Date): number | null {
  const t = new Date(postedAt).getTime();
  if (!Number.isFinite(t)) return null;
  return (now.getTime() - t) / 86_400_000;
}

/**
 * Freshness gate. Unparseable and future-dated timestamps are treated as
 * stale — the opposite of the fail-open choice in engagementWindow.ts, and
 * deliberately so. There, failing open risked freezing a consenting
 * borrower's cadence forever. Here, failing open risks putting a stranger
 * with no relationship to us in front of a reviewer. When the cost of a
 * false positive is contacting the wrong person, ambiguity should exclude.
 */
export function isStale(postedAt: string, now: Date, maxAgeDays = MAX_SIGNAL_AGE_DAYS): boolean {
  const age = ageInDays(postedAt, now);
  if (age === null) return true;
  if (age < 0) return true;
  return age > maxAgeDays;
}

function normalise(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ");
}

/**
 * Scores 0–100 on how likely this is a real person actively seeking the kind
 * of financing we originate. Returns `rejectedReason` when the candidate
 * should not reach the review queue at all.
 */
export function scoreCandidate(
  candidate: RawCandidate,
  now: Date,
  maxAgeDays = MAX_SIGNAL_AGE_DAYS
): ScoredCandidate {
  const haystack = normalise(`${candidate.title} ${candidate.body}`);
  const matched: string[] = [];

  const reject = (rejectedReason: string): ScoredCandidate => ({
    ...candidate,
    intentScore: 0,
    matchedKeywords: [],
    rejectedReason,
  });

  if (isStale(candidate.postedAt, now, maxAgeDays)) {
    return reject(`Older than ${maxAgeDays} days, or timestamp unusable`);
  }
  // Deleted authors cannot be replied to, so the signal is unactionable even
  // if the intent is perfect.
  const handle = candidate.authorHandle.replace(/^u\//, "").toLowerCase();
  if (handle === "[deleted]" || handle === "automoderator" || handle === "") {
    return reject("Author deleted or automated");
  }
  if (haystack.trim().length < 40) {
    return reject("Too little text to judge intent");
  }
  const negative = NEGATIVE_MARKERS.find((m) => haystack.includes(m));
  if (negative) return reject(`Industry/promotional context ("${negative}")`);

  const foreign = OUT_OF_MARKET.find((m) => haystack.includes(m));
  if (foreign) return reject(`Appears to be outside our lending market ("${foreign}")`);

  let score = 0;

  for (const term of QUERY_TERMS.primary) {
    if (haystack.includes(term.toLowerCase())) {
      score += 18;
      matched.push(term);
    }
  }
  for (const term of QUERY_TERMS.secondary) {
    if (haystack.includes(term.toLowerCase())) {
      score += 8;
      matched.push(term);
    }
  }
  if (matched.length === 0) return reject("No mortgage-intent vocabulary present");

  for (const phrase of ACTION_PHRASES) {
    if (haystack.includes(phrase)) {
      score += 12;
      matched.push(phrase);
    }
  }

  // Asking a question is the difference between someone seeking help and
  // someone narrating their situation.
  if (/\?/.test(candidate.title) || /\b(should|how|what|anyone|advice|help)\b/.test(normalise(candidate.title))) {
    score += 8;
  }

  // First person, present tense — "we have 200k in equity" beats a hypothetical.
  if (/\b(i|we|my|our)\b/.test(haystack)) score += 6;

  // Recency inside the allowed window still matters: a post from this morning
  // is worth far more than one from twelve days ago.
  const age = ageInDays(candidate.postedAt, now) ?? maxAgeDays;
  score += Math.round(14 * Math.max(0, 1 - age / maxAgeDays));

  const subWeight = DISCOVERY_SUBREDDITS.find((s) => s.name.toLowerCase() === candidate.subreddit.toLowerCase())?.weight ?? 0.5;
  score = Math.round(score * subWeight);

  // A comment is a reply inside someone else's thread — often the commenter
  // is answering rather than asking.
  if (candidate.kind === "COMMENT") score = Math.round(score * 0.85);

  return {
    ...candidate,
    intentScore: Math.max(0, Math.min(100, score)),
    matchedKeywords: Array.from(new Set(matched)),
  };
}

/**
 * Minimum score to reach a human. Set so the reviewer's queue stays worth
 * opening — precision matters more than recall here, because every false
 * positive costs a person's attention and every missed post costs nothing we
 * can measure.
 */
export const MIN_INTENT_SCORE = 30;

/**
 * Combines the deterministic keyword/recency score with a model's judgement.
 *
 * The weighting is deliberately conservative — 60% measured, 40% judged.
 * The deterministic half is reproducible and cannot drift when a model or
 * prompt changes; the model half sees things no keyword list can. Letting the
 * model dominate would make yesterday's queue unexplainable today, which
 * matters when a reviewer asks "why is this at the top".
 *
 * `isProspect: false` collapses the score to zero rather than reducing it.
 * That verdict is categorical, not a matter of degree: a loan officer
 * advertising in r/Mortgages can score extremely well on every measurable
 * axis, which is exactly why the deterministic half cannot catch them.
 */
export function blendScore(
  deterministic: number,
  model: { isProspect: boolean; qualityScore: number; simulated: boolean }
): number {
  if (!model.isProspect) return 0;
  // No model available — don't dilute a real score with a zero.
  if (model.simulated) return deterministic;
  return Math.round(deterministic * 0.6 + model.qualityScore * 0.4);
}

export function selectSignals(
  candidates: RawCandidate[],
  now: Date,
  opts: { maxAgeDays?: number; minScore?: number; limit?: number } = {}
): ScoredCandidate[] {
  const { maxAgeDays = MAX_SIGNAL_AGE_DAYS, minScore = MIN_INTENT_SCORE, limit = 50 } = opts;
  const seen = new Set<string>();
  const kept: ScoredCandidate[] = [];

  for (const c of candidates) {
    const key = dedupeKey(c.sourceUrl);
    if (seen.has(key)) continue;
    seen.add(key);
    const scored = scoreCandidate(c, now, maxAgeDays);
    if (scored.rejectedReason) continue;
    if (scored.intentScore < minScore) continue;
    kept.push(scored);
  }

  return kept.sort((a, b) => b.intentScore - a.intentScore).slice(0, limit);
}
