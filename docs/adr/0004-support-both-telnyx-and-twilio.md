# ADR-0004 — Support both Telnyx and Twilio rather than choosing one

- **Status:** Accepted
- **Date:** 2026-08-10

## Context

The platform needs programmable SMS and voice. Twilio was integrated first.
Telnyx was raised as an alternative on cost grounds.

The comparison, at the volumes this business plans for:

| | Telnyx | Twilio |
| --- | --- | --- |
| SMS (outbound, US) | materially cheaper per segment | market rate |
| Voice | cheaper per minute | market rate |
| Ecosystem, docs, community | smaller | the reference implementation |
| 10DLC registration | required, 1–3 business days | required, 1–3 business days |
| Inline call instructions | **not supported** — TeXML must be hosted at a URL | supported inline (TwiML in the request) |

Neither is clearly correct. Telnyx wins on unit economics, which matters at
volume. Twilio wins on operational maturity and on being the vendor every
integration guide and every future contractor already knows.

The 10DLC lead time is the decisive operational fact: carrier registration takes
days on either provider, and being blocked on a single vendor's approval with a
launch date fixed is a real risk.

## Decision

Support both. Each is a separate adapter behind one interface; the active
provider is whichever has credentials configured, resolved at call time per
ADR-0002, with Telnyx preferred when both are present.

## Rationale

The abstraction was already there. Both providers are wrapped behind
`sendSms()` / `placeCall()` in `src/adapters/`, and after ADR-0002 the
provider selection is a credential lookup rather than a build-time decision.
Supporting the second one cost one adapter, not an architecture.

That buys three things:

- **No vendor lock-in on a cost decision made early.** Switching is entering a
  different key in the admin panel.
- **A live fallback.** If one provider's 10DLC registration stalls or a number
  gets flagged, the other is a configuration change away, not a sprint.
- **The choice can be made with real data.** Run both, compare delivery rates
  and actual invoices, then consolidate — rather than committing on a
  spreadsheet.

## The one real asymmetry

Telnyx has no inline-content field for call instructions. Twilio accepts TwiML
directly in the API request; Telnyx requires TeXML to be reachable at a URL. The
voice adapter therefore hosts a TeXML endpoint for the Telnyx path. This is the
only place the two providers are not interchangeable, and it is contained to
`src/adapters/voice.ts`.

## Consequences

- Two integrations to keep working, and two sets of provider quirks. The
  interface boundary keeps that cost bounded to the adapter layer.
- 10DLC registration should be started on **both** providers immediately, since
  the lead time is the binding constraint and the registrations are independent.
- The eventual consolidation onto one provider (once real volume data exists) is
  a deletion, not a migration.
