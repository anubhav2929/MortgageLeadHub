# Architecture

## The shape of the problem

Most of this system is ordinary CRUD. A small part of it is not: deciding
whether a particular borrower may be contacted, on which channel, at what hour,
by whom. That decision is regulated (TCPA, FCRA, state licensing, carrier 10DLC
rules), it is auditable after the fact, and getting it wrong is a fine rather
than a bug report.

So the architecture is organised around a single idea: **the rules that carry
legal weight are pure functions with no I/O, and every path that can reach a
borrower must go through them.** Everything else — the database, the Next.js
routing, the vendor SDKs — is arranged around that core and kept out of it.

## Layers

Dependencies point inward only. `tests/architecture.test.ts` enforces this on
every CI run, so the diagram below is executable, not aspirational.

```
  app/  ──────────►  components/
    │                    │
    └────────┬───────────┘
             ▼
         domain/  ─────────►  adapters/  ────────►  external vendors
             │                    │
             └────────┬───────────┘
                      ▼
                    core/          (no I/O, no framework, no vendors)
```

| Layer | Holds | May import | Must never import |
| --- | --- | --- | --- |
| `src/core/` | Business rules as pure functions | `@/domain/types`, `@/domain/stateTimezone` (types and reference tables only) | Anything else — no `next`, no `react`, no `pg`, no `fs`, no vendor SDK, no `process.env` |
| `src/domain/` | Entities, persistence, server actions | `core/`, `adapters/`, `lib/` | `react`, `@/components/` |
| `src/adapters/` | The only place a vendor SDK or outbound HTTP call lives | `core/`, `domain/types`, `lib/runtimeConfig` | `@/components/`, `@/app/`, `process.env` directly |
| `src/app/` | Next.js routes, pages, webhooks | everything | — |
| `src/components/` | React UI | `core/`, `domain/types` | `domain/store`, `adapters/` |

### Why `core/` is quarantined

`src/core/` is about 1,400 lines and holds the PolicyGate, the lead state
machine, the scoring model, the promotion rules, the channel router, the
credential cipher, and the permission matrix. Because none of it touches I/O:

- its 223 unit tests run in under a second with **no mocks, no fixtures, no test
  database** — the tests describe behaviour, not wiring;
- a compliance reviewer can read the rules without reading the framework;
- the rules can be reasoned about exhaustively, which is what makes it
  defensible to say "the system cannot text someone at 4am" rather than "we
  don't think it does".

Two exceptions are deliberate and documented in the boundary test itself:
`core/secretBox.ts` reads `CREDENTIAL_SECRET` from the environment (it cannot
come from the store it exists to decrypt), and `core/` imports `domain/types`
for shared entity type declarations, which are erased at compile time and carry
no behaviour.

## How a lead moves through the system

```
  Public intake form  (the only unauthenticated write path)
        │
        ▼
  intakeValidation.ts   Zod schema — the actual trust boundary
        │
        ▼
  leadScoring.ts        100-point model → HOT | STANDARD
        │
        ├── HOT ──────►  routing.ts       licensed, available officer
        │                                 (state licensing is a hard constraint)
        └── STANDARD ─►  cadence.ts       most-specific matching plan
                              │
                              ▼
                      ┌───────────────┐
                      │  PolicyGate   │  ◄── every outbound touch, no exceptions
                      └───────────────┘
                              │ allowed
                              ▼
                      channelRouter.ts    which channel, and why
                              │
                              ▼
                      adapters/ (sms · voice · email · llm)
                              │
                              ▼
                      ContactAttempt + ConversationSession
                              │
                              ▼
                      extraction/promote.ts   model output → asserted facts
                              │
                              ▼
                      stateMachine.ts   the only writer of lead state
```

Four choke points do the real work:

**PolicyGate** (`core/policyGate.ts`) is the single gate every outbound message
passes. It checks the kill switch, the suppression list, per-channel consent,
terminal lead states, officer ownership, quiet hours in the borrower's own
timezone (with the stricter Florida window where it applies), weekend rules,
attempt caps, and minimum spacing. Rule precedence matters and is tested
directly: a permanent bar must always outrank a temporary defer, so a
suppressed lead is never merely rescheduled to the morning.

**The state machine** (`core/stateMachine.ts`) is the only thing that writes
lead state, and it throws on an illegal transition rather than coercing. A bug
surfaces where the mistake happened, not weeks later as an impossible state in a
report. Compliance events (`OPT_OUT_RECEIVED`, `DNC_MATCH`, `COMPLAINT`,
`WRONG_PARTY`) short-circuit from any active state; terminal states accept
nothing at all.

**Promotion** (`core/extraction/promote.ts`) is the boundary between what a
language model claimed it heard and what the system asserts about a borrower. A
candidate with no transcript citation is never promoted regardless of
confidence; an officer-entered value is never overwritten; a disagreement with
an already-confirmed value becomes `CONFLICTED` for a human to adjudicate rather
than resolving itself.

**The channel router** (`core/channelRouter.ts`) ranks channels by explainable
weighted rules and can only ever choose from the set PolicyGate already
permitted — it narrows, never widens. Its output includes the score for every
candidate channel and a plain-English reason, because "why did the system call
this person?" is a question with regulatory weight.

## The conversation thread is derived, not stored

A borrower's history spans three stores: `ContactAttempt` (what we sent),
`ConversationSession` (call transcripts), and `Note` (inbound replies).
`core/conversationThread.ts` merges them into one ordered view on read, rather
than maintaining a fourth "messages" table.

A parallel store written from five different code paths drifts, and a thread
that silently disagrees with the audit log is worse than no thread. Deriving it
costs a merge on each read and makes drift structurally impossible. The
non-obvious part is de-duplication: an AI call exists as *both* an attempt and a
session, and a naive merge shows every call twice — which then feeds a doubled
history back into the model on the next touch. See
[ADR-0001](docs/adr/0001-derived-conversation-thread.md).

## Configuration resolves at runtime

Integration credentials are read on every call from the encrypted store, falling
back to environment variables. Nothing is captured into a module-level constant.

This is a correctness requirement, not a convenience: capability flags computed
at module load meant a key entered in the admin panel was ignored until the
process restarted, which on serverless is unpredictable. An operator entering a
key and seeing nothing change has no way to tell a wrong key from a stale
process. See [ADR-0002](docs/adr/0002-runtime-credential-resolution.md) and
[ADR-0003](docs/adr/0003-credential-encryption-at-rest.md).

`tests/architecture.test.ts` fails the build if any adapter reads `process.env`
directly, which is the specific regression that would reintroduce the bug.

## Testing strategy

Unit tests target `src/core/` and are the enforced gate (80% lines / 80%
functions / 75% branches / 80% statements; currently 99% / 100% / 93% / 99%).
That is a deliberate concentration rather than a coverage target applied
uniformly — the value of a test is proportional to the cost of the behaviour
being wrong, and in this system that cost is concentrated in a small, pure,
fully testable core.

Layers outside `core/` are covered by the type checker, the production build,
and the architecture boundary tests. See [CONTRIBUTING.md](CONTRIBUTING.md#tests)
for what a good test looks like here.

## Data model notes

Persistence is a single JSON-blob-per-collection schema in Postgres
(`src/domain/persistence.ts`), with a file-backed store for local development.
This keeps schema changes free during a fast-moving build. It is the right
trade-off at the current data volume and the wrong one at 10× — the migration
path is to normalise the read-heavy collections (`leads`, `contactAttempts`)
first and leave the rest as blobs.
