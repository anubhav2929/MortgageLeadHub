# Contributing

Read [ARCHITECTURE.md](ARCHITECTURE.md) first. This document covers the working
agreements — what to run, what a good change looks like, and what a reviewer
will push back on.

## Before you push

```bash
npm run verify
```

That is `typecheck → lint → test → build`, the same four steps CI runs. Running
it locally is faster than a round trip through CI.

## Where code goes

| If it… | It belongs in |
| --- | --- |
| decides something and needs no I/O | `src/core/` |
| reads or writes our data | `src/domain/` |
| talks to a third party | `src/adapters/` |
| is a route, page, or webhook | `src/app/` |
| renders | `src/components/` |

Dependencies point inward. `tests/architecture.test.ts` enforces this — if you
add an import that crosses a boundary, that test fails with the offending
`file → import` pair. When it fails, the fix is nearly always to move the logic
inward rather than to relax the rule.

### Adding a business rule

Put it in `core/` as a pure function, and test it there. If it needs data to
decide, take the data as a parameter rather than fetching it — that is what
keeps the core testable without a database and keeps the rule reviewable
without the framework around it.

### Adding an integration

1. Add the definition to `core/integrationRegistry.ts` — required keys, form
   fields, setup steps, docs URL. This single definition drives both the runtime
   capability check and the admin panel UI, including the instructions an
   operator follows. There is no second place to update.
2. Write the adapter in `src/adapters/`. Resolve credentials with
   `getConfigValue()` **on every call** — never at module load, never from
   `process.env` directly.
3. Degrade, don't throw. With no credentials configured, log the intended action
   and return a simulated result. Someone must be able to run the whole product
   with no accounts anywhere.

## Tests

Unit tests live in `tests/` and target `src/core/`. Coverage thresholds are
enforced on `src/core/**` only (80/80/75/80).

**Test behaviour, not implementation.** A test that would still pass after the
function is rewritten is a good test; one that breaks when a variable is renamed
is a liability.

**Say why in the test.** Where a case exists because getting it wrong is
expensive, write that down. Compare:

```ts
// weak — restates the code
it("returns false when confidence < 0.85", () => { … });

// strong — records the reasoning
it("refuses to promote a value the model can't point to in the transcript", () => {
  // High confidence with no citation is exactly the shape of a
  // hallucination, so confidence alone must not be enough.
  …
});
```

**Pin the boundaries.** Off-by-one errors in this system change who gets called
and when. Test at the threshold, on both sides of it.

**Prefer a real input over a mock.** The core is pure; if you find yourself
reaching for `vi.mock`, the thing under test probably belongs in `domain/` or
`adapters/` instead — or has a dependency it shouldn't have.

## Things a reviewer will stop

- A new outbound path that doesn't go through `PolicyGate`.
- A lead state written anywhere other than `stateMachine.transition()`.
- `process.env` in an adapter (see [ADR-0002](docs/adr/0002-runtime-credential-resolution.md)).
- A secret, key, or borrower PII in a log line, an audit record, or an error
  message. Audit entries record key *names* and outcomes, never values.
- A `catch {}` that swallows a failure the operator needed to see. Failing
  loudly beats failing invisibly, except where degrading to simulated is the
  documented behaviour.
- Compliance copy, disclosures, or consent language changed without a note
  explaining who approved it.
- A new dependency added for something the standard library does. Password
  hashing, HMAC verification, and AES-GCM here all use `node:crypto` for this
  reason.

## Commits

Present tense, imperative, and explain *why* when the what isn't obvious:

```
Resolve integration credentials at call time

Capability flags computed at module load meant a key entered in the
admin panel was ignored until the process restarted, which on
serverless is unpredictable.
```

## Architecture decision records

Non-obvious decisions get an ADR in [docs/adr/](docs/adr/). If you are about to
write a long comment explaining why the obvious approach was rejected, that is
an ADR. Copy the format of an existing one; keep it to a page.
