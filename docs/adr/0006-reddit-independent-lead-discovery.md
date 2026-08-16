# ADR-0006 — Reddit-independent lead discovery

- **Status:** Accepted
- **Date:** 2026-08-15
- **Supersedes:** the Reddit OAuth path in `adapters/leadDiscovery.ts`

## Context

Lead discovery searched Reddit through an OAuth "script" app registered at
`reddit.com/prefs/apps`. That registration is no longer dependably available,
so the feature could not be configured at all — and Reddit credentials were a
hard dependency for a capability that is really "find public mortgage
conversations", not "use Reddit's API".

## Benchmark

Measured against live endpoints on 15 Aug 2026, not from documentation.

| | PullPush | Arctic Shift |
| --- | --- | --- |
| Newest indexed content | **452 days old** | **same day** |
| Auth required | none | none |
| Results/request | ~100 | 100 |
| Global keyword search | yes | **no** — needs `subreddit` or `author` |
| Reliability | 502s under load | stable within its budget |

Freshness is the only axis that decides a lead-gen feature: a mortgage
question from last year has resolved, and contacting the person reads as
surveillance rather than service. On that axis the result was not close.

## Decision

**Arctic Shift is the sole retrieval source. PullPush is not wired in, not
even as a fallback.**

Falling back to a 452-day-stale archive would fill the review queue with dead
leads *while still looking like the feature worked* — strictly worse than
returning nothing, because nothing is legible as a failure and stale results
are not. When Arctic Shift is unavailable we say so.

### Recency sweep, not keyword search

Arctic Shift cannot do internet-wide keyword search, so we scope to a
curated set of consumer finance subreddits. The obvious next step — search each
subreddit for each intent term — was implemented, measured, and rejected:

| | keyword sweep | recency sweep |
| --- | --- | --- |
| Requests | 36 | **11** |
| Latency | **345 s** | **30 s** |
| Failed requests | **19 of 36** | **0** |
| Signals kept | 50 | 50 |

The archive answered overload with `"Timeout. Maybe slow down a bit"` — the
failures were self-inflicted by request volume. Full-text search is the
expensive operation; time-indexed reads are cheap.

So we ask only for *recent posts per subreddit* and do all keyword and intent
filtering locally in `core/discoveryQuery.ts`. Identical yield for a third of
the requests and a tenth of the latency.

This is better on quality too, not just cost. Local filtering catches intent
phrased in ways no term list anticipates — *"can I pull money out of my house
to pay off cards?"* contains none of our keywords as written, and a
server-side keyword search would never have returned it.

## Consequences

**Replaceability.** Everything vendor-specific is confined to
`fetchFromArctic()`. Swapping archives means writing one function returning
`RawCandidate[]`; scoring, dedup, and the review pipeline are untouched. This
matters because the source's access policy is outside our control — the
premise of this ADR is that exactly that happened to Reddit.

**Per-request fault isolation.** One failing subreddit costs us that
subreddit and nothing else. An earlier version let a failure escape the loop
and a single 422 cut a 40-search sweep to 6 — silently, because a partial
result still looked like a successful run. Total failure is reported as an
error; partial failure is reported as partial.

**Ambiguity excludes.** Unparseable and future-dated timestamps are treated as
stale — the opposite of the fail-open rule used for outreach pacing. See
[ADR-0008](0008-fail-open-and-fail-closed-defaults.md) for the principle that
reconciles the two.

**Scoring is deterministic, not model-derived.** `confidence` comes from the
keyword/recency function in core, which is reproducible and explainable to a
reviewer and cannot drift when the model changes. The LLM is still trusted for
*which* product the person wants — a judgement call rather than a measurement.

## The boundary this does not touch

Discovered posts remain `DiscoveredSignal`, never `Lead`. Nobody found this
way has given consent of any kind, so they must stay unreachable by PolicyGate
and the cadence, which only ever read `db.leads`. This ADR changes where
signals come from and nothing about what may be done with them.

That constraint is what keeps this a compliant discovery layer: it surfaces
public conversation for a human to read and decide on, and the only outbound
path is an officer choosing to reply in the thread, in public, where the
person is already talking.
