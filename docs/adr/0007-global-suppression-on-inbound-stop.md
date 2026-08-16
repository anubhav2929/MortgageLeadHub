# ADR-0007 — Treat an inbound STOP as a global, cross-channel suppression

- **Status:** Accepted
- **Date:** 2026-08-14

## Context

The SMS consent text a borrower agrees to at intake states: *"Reply STOP to opt
out at any time."* The privacy policy repeats it, and the FAQ goes further —
"it takes effect immediately and permanently, **across every channel**."

Carriers enforce STOP on their own channel automatically: once a subscriber
replies STOP, the carrier stops delivering our messages to that number whether
or not we ever learn about it. That behaviour is invisible to the application.

The result was a system that appeared to work while breaking its own promise.
The carrier silently blocked SMS; the application never received the reply, so
the cadence continued placing calls and sending email to a borrower who had
explicitly asked us to stop. `selfServeOptOutAction` even carried a comment
claiming "the SMS STOP-reply path both land here eventually" — nothing called
it.

Under TCPA that is a per-message statutory exposure, and sustained violations
put the 10DLC registration — and therefore the entire SMS channel — at risk.

## Decision

Receive inbound messages on a dedicated webhook and, on a STOP keyword, create
a **GLOBAL** suppression rather than an SMS-only one.

Supporting rules, each chosen against a specific failure:

**Exact-match keywords only for automatic suppression.** The CTIA keyword sets
(STOP/START/HELP and their variants) are matched as whole messages. Substring
matching would suppress "stop by tomorrow if you can" — a live borrower
arranging a meeting — and the lead would be silently killed with no signal that
anything had happened.

**Fuzzy opt-out phrases escalate, never suppress.** "Please stop calling me"
raises a COMPLAINT task for a human. Ignoring it is wrong; acting on it
automatically is also wrong, because the same phrasing appears in messages that
are not opt-outs. A person decides.

**START lifts only a suppression created by STOP.** Suppressions from a DNC
match, a complaint, or a litigation hold were placed by someone other than the
borrower and must not be reversible by an inbound message. This is also the
control that stops a forged inbound START from re-enabling outreach to a
suppressed number.

**The confirmation reply bypasses PolicyGate.** Carriers require exactly one
confirmation message after STOP. PolicyGate would — correctly — refuse it,
because it is evaluating the suppression that was just written. This is the
only sanctioned bypass in the system and it is limited to that single message.

**Both compliance replies stay within one SMS segment.** A multi-segment reply
can be truncated in transit, which would drop the required opt-out instruction
from a message whose entire purpose is to carry it. Asserted in tests.

## Alternatives rejected

**Rely on carrier-side STOP alone.** This is what the system did. It satisfies
the SMS channel and nothing else, and it contradicts published copy the
borrower relied on.

**Suppress the SMS channel only.** Matches the literal mechanism of the reply
but not the borrower's evident intent, and directly contradicts the FAQ. A
borrower who says stop and then receives a phone call has been told one thing
and shown another.

## Consequences

A STOP now stops voice and email as well as SMS, which is what was always
promised. Inbound replies that are not keywords are captured as
borrower-authored notes and join the unified conversation thread, closing a
long-standing gap where the officer and the AI agent could not see what the
borrower had actually said.

The webhook is authenticated with a shared secret and returns 200 to the
carrier in all cases, including rejection — carriers retry and eventually
disable endpoints that error, and losing the endpoint would reintroduce exactly
the failure this record exists to prevent.
