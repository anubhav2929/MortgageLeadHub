import { describe, expect, it } from "vitest";
import {
  MAX_SIGNAL_AGE_DAYS,
  MIN_INTENT_SCORE,
  blendScore,
  dedupeKey,
  isStale,
  scoreCandidate,
  selectSignals,
  type RawCandidate,
} from "@/core/discoveryQuery";

// Discovery finds strangers who have given us no consent. The expensive
// failure is not a missed post — it is a reviewer's queue full of press
// releases, brokers advertising, and year-old questions, which trains them to
// stop opening it. These tests defend precision.

const NOW = new Date("2026-08-15T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

function candidate(overrides: Partial<RawCandidate> = {}): RawCandidate {
  return {
    sourceUrl: "https://www.reddit.com/r/Mortgages/comments/abc123/post/",
    subreddit: "Mortgages",
    authorHandle: "u/real_person",
    title: "Should I refinance? Stuck at 7.1% from 2023",
    body: "We bought in 2023 at 7.1% and I want to lower my rate. Is it worth refinancing right now, or should we wait? Looking for a recommendation on a lender.",
    postedAt: hoursAgo(3),
    kind: "POST",
    ...overrides,
  };
}

describe("scoring genuine borrower intent", () => {
  it("scores an active refinance question highly", () => {
    const s = scoreCandidate(candidate(), NOW);
    expect(s.rejectedReason).toBeUndefined();
    expect(s.intentScore).toBeGreaterThan(MIN_INTENT_SCORE);
    expect(s.matchedKeywords).toContain("refinance");
  });

  it("ranks a fresh post above an otherwise identical old one", () => {
    const fresh = scoreCandidate(candidate({ postedAt: hoursAgo(1) }), NOW);
    const old = scoreCandidate(candidate({ postedAt: daysAgo(12) }), NOW);
    expect(fresh.intentScore).toBeGreaterThan(old.intentScore);
  });

  it("weights a topical subreddit above a general one", () => {
    const topical = scoreCandidate(candidate({ subreddit: "Mortgages" }), NOW);
    const general = scoreCandidate(candidate({ subreddit: "personalfinance" }), NOW);
    expect(topical.intentScore).toBeGreaterThan(general.intentScore);
  });

  it("discounts comments below top-level posts", () => {
    const post = scoreCandidate(candidate({ kind: "POST" }), NOW);
    const comment = scoreCandidate(candidate({ kind: "COMMENT" }), NOW);
    expect(comment.intentScore).toBeLessThan(post.intentScore);
  });
});

describe("rejecting noise that shares our vocabulary", () => {
  it("rejects industry self-promotion", () => {
    // The exact failure mode of a naive keyword search: loan officers
    // advertising in the same threads our prospects post in.
    const s = scoreCandidate(
      candidate({ body: "I am a loan officer and can help you refinance, DM me for rates." }),
      NOW
    );
    expect(s.rejectedReason).toMatch(/industry|promotional/i);
  });

  it("rejects commercial and press-release chatter", () => {
    const s = scoreCandidate(
      candidate({
        subreddit: "RealEstate",
        title: "JLL arranges $650M refinancing for One Congress",
        body: "Press release: the commercial property refinancing closed this week for the apartment complex.",
      }),
      NOW
    );
    expect(s.rejectedReason).toBeDefined();
  });

  it("rejects out-of-market posts we cannot originate", () => {
    const s = scoreCandidate(
      candidate({ body: "Looking to refinance my mortgage in Ontario, Canada. Any advice on lenders?" }),
      NOW
    );
    expect(s.rejectedReason).toMatch(/lending market/i);
  });

  it("rejects deleted authors, who cannot be replied to", () => {
    expect(scoreCandidate(candidate({ authorHandle: "u/[deleted]" }), NOW).rejectedReason).toBeDefined();
    expect(scoreCandidate(candidate({ authorHandle: "u/AutoModerator" }), NOW).rejectedReason).toBeDefined();
  });

  it("rejects text with no mortgage vocabulary at all", () => {
    const s = scoreCandidate(
      candidate({ title: "Best way to seal a deck before winter?", body: "Built a deck this summer and want a sealant on it before the weather turns. Recommendations?" }),
      NOW
    );
    expect(s.rejectedReason).toMatch(/vocabulary/i);
  });
});

describe("freshness — ambiguity must exclude, not include", () => {
  it("drops anything past the age limit", () => {
    // The PullPush benchmark returned 452-day-old posts as its newest
    // content. This is the guard that stops that class of data reaching a
    // reviewer if a source ever degrades that way again.
    expect(isStale(daysAgo(452), NOW)).toBe(true);
    expect(isStale(daysAgo(MAX_SIGNAL_AGE_DAYS + 1), NOW)).toBe(true);
    expect(isStale(hoursAgo(2), NOW)).toBe(false);
  });

  it("treats unparseable and future timestamps as stale", () => {
    // Deliberately the opposite of engagementWindow's fail-open rule. There,
    // failing open delayed a consenting borrower; here, failing open would
    // surface a stranger. When in doubt, exclude.
    expect(isStale("not-a-date", NOW)).toBe(true);
    expect(isStale(new Date(NOW.getTime() + 86_400_000).toISOString(), NOW)).toBe(true);
  });
});

describe("deduplication across runs and host variants", () => {
  it("treats reddit URL variants as the same thread", () => {
    const base = "https://www.reddit.com/r/Mortgages/comments/abc/x/";
    expect(dedupeKey(base)).toBe(dedupeKey("http://old.reddit.com/r/Mortgages/comments/abc/x"));
    expect(dedupeKey(base)).toBe(dedupeKey("https://reddit.com/r/Mortgages/comments/abc/x/?utm_source=share"));
  });

  it("does not collapse genuinely different threads", () => {
    expect(dedupeKey("https://reddit.com/r/a/comments/1/x")).not.toBe(dedupeKey("https://reddit.com/r/a/comments/2/x"));
  });

  it("returns each thread once even when several queries match it", () => {
    const dupe = candidate();
    const results = selectSignals([dupe, { ...dupe, sourceUrl: dupe.sourceUrl.replace("www.", "old.") }], NOW);
    expect(results).toHaveLength(1);
  });
});

describe("selection", () => {
  it("returns highest intent first", () => {
    const weak = candidate({
      sourceUrl: "https://reddit.com/r/personalfinance/comments/2/x",
      subreddit: "personalfinance",
      title: "Notes on my budget",
      body: "Writing down my situation. We have a home loan and some closing costs coming up next year at some point.",
      postedAt: daysAgo(10),
    });
    const [first] = selectSignals([weak, candidate()], NOW);
    expect(first.title).toMatch(/refinance/i);
  });

  it("filters everything below the review threshold", () => {
    for (const s of selectSignals([candidate(), candidate({ sourceUrl: "https://reddit.com/r/x/comments/9/y" })], NOW)) {
      expect(s.intentScore).toBeGreaterThanOrEqual(MIN_INTENT_SCORE);
    }
  });

  it("honours the result limit", () => {
    const many = Array.from({ length: 80 }, (_, i) =>
      candidate({ sourceUrl: `https://reddit.com/r/Mortgages/comments/${i}/x` })
    );
    expect(selectSignals(many, NOW, { limit: 25 })).toHaveLength(25);
  });

  it("returns nothing rather than something wrong when every candidate is noise", () => {
    const junk = candidate({ title: "deck sealant", body: "how do I seal my deck before winter arrives this year" });
    expect(selectSignals([junk], NOW)).toEqual([]);
  });
});

describe("blending the measured score with the model's judgement", () => {
  const model = (over: Partial<{ isProspect: boolean; qualityScore: number; simulated: boolean }> = {}) => ({
    isProspect: true,
    qualityScore: 80,
    simulated: false,
    ...over,
  });

  it("weights the reproducible half more heavily", () => {
    // 60/40 toward the deterministic score, so yesterday's ranking stays
    // explainable when a model or prompt changes.
    expect(blendScore(50, model({ qualityScore: 100 }))).toBe(70);
    expect(blendScore(50, model({ qualityScore: 0 }))).toBe(30);
  });

  it("zeroes a non-prospect outright rather than nudging it down", () => {
    // A loan officer advertising in r/Mortgages scores well on every
    // measurable axis — which is exactly why the keyword half can't catch
    // them, and why this verdict has to be categorical.
    expect(blendScore(95, model({ isProspect: false }))).toBe(0);
  });

  it("leaves the deterministic score untouched when no model ran", () => {
    // Otherwise an unconfigured LLM would silently halve every score and the
    // whole queue would drop below the review threshold.
    expect(blendScore(64, model({ simulated: true, qualityScore: 0 }))).toBe(64);
  });

  it("stays inside 0-100 for any model output", () => {
    for (const q of [0, 50, 100]) {
      const out = blendScore(100, model({ qualityScore: q }));
      expect(out).toBeGreaterThanOrEqual(0);
      expect(out).toBeLessThanOrEqual(100);
    }
  });
});
