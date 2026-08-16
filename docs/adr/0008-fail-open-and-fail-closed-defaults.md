# ADR-0008 — Choose fail-open or fail-closed by the direction of harm

- **Status:** Accepted
- **Date:** 2026-08-15

## Context

Several independent components decide what to do with input they cannot
interpret — a missing timestamp, an unparseable date, a malformed model
response. Left to individual judgement these defaults drift, and the drift is
invisible: a component that quietly excludes and a component that quietly
proceeds both look correct in isolation and in tests.

Two of these sit close enough together to look like they should match, and
resolving them the same way would have been wrong.

## Decision

The default is chosen by asking which mistake is worse, not by picking one rule
for the codebase.

**Automated-outreach pacing fails OPEN.** `core/engagementWindow.ts` holds
automated contact while a borrower is active in the post-submit chat. Every
degenerate input — missing, unparseable, or future-dated timestamp — proceeds
with outreach. A corrupt value must never be able to freeze a consenting
borrower's cadence permanently, which is a far worse outcome than one
unnecessary text. The failure this protects against is silent and unbounded:
nobody notices a lead that is never contacted.

**Lead-discovery inclusion fails CLOSED.** `core/discoveryQuery.ts` scores
public forum posts for a review queue. The same degenerate inputs are treated
as stale and excluded. Here, failing open surfaces a stranger who has no
relationship with us to an officer preparing to make contact. The cost of a
false positive is a person, not a message.

The rule that reconciles them: **when the cost of being wrong falls on someone
who has consented, prefer acting; when it falls on someone who has not, prefer
abstaining.**

Two applications of the same principle elsewhere:

- `CRON_SECRET` fails **closed** — the cadence endpoint places real calls and
  texts, so an unauthenticated caller must be refused even at the cost of the
  scheduler not running.
- A model response that cannot be parsed defaults `isProspect` to **true**,
  routing the item to human review rather than discarding it. A malformed
  response should degrade to the pre-AI behaviour, not to silent deletion.

## Alternatives rejected

**One uniform default.** Simpler to state and wrong in one direction whichever
way it is set. Uniformly fail-closed freezes cadences on a clock-skew bug;
uniformly fail-open puts unvetted strangers in front of officers.

**Raise an error and let the caller decide.** Moves the decision to call sites,
where it gets made ad hoc under deadline and stops being reviewable. The point
of fixing it here is that the choice is stated once, in a pure function, with
the reasoning attached.

## Consequences

Each degenerate-input path has an explicit, tested expectation rather than an
incidental one, and a reviewer can check the choice against the principle
rather than against taste. The cost is that "what happens on bad input" is not
answerable in one sentence for the whole system — it requires knowing which
side of the consent boundary the code sits on.
