# ADR-0005 — Keep compliance logic in a pure, I/O-free core

- **Status:** Accepted
- **Date:** 2026-08-10

## Context

The rules that decide whether a borrower may be contacted — consent per channel,
suppression, quiet hours in the borrower's local timezone, attempt caps, minimum
spacing, state licensing, the global kill switch — are regulated under TCPA,
FCRA, and state law. They are audited after the fact. Getting them wrong
produces fines, not bug reports.

The natural Next.js shape would put those checks inline in server actions, next
to the database reads that supply their inputs. That is how most of this kind of
application gets written.

## Decision

All such rules live in `src/core/` as pure functions: no database access, no
filesystem, no `next`, no `react`, no vendor SDK, no `process.env`. Data is
passed in as parameters. `tests/architecture.test.ts` fails the build on any
import that violates this.

## Rationale

**It makes the rules exhaustively testable.** The 223 unit tests run in under a
second with no mocks, no fixtures, and no test database. That is not a
performance nicety — it is what makes it practical to test rule *precedence*
directly, e.g. that a permanent bar (suppression) always outranks a temporary
defer (quiet hours), so a suppressed lead is never merely rescheduled to the
morning. Those combinatorial cases are the ones that get skipped when each test
needs a seeded database.

**It makes the rules reviewable by someone who is not a Next.js engineer.** A
compliance reviewer, or a SoftCheck inspector, can read `core/policyGate.ts`
end to end and see every condition. Interleaved with `await getDb()` calls and
React server-component plumbing, the same logic is unreadable to exactly the
audience that most needs to read it.

**It makes the claim defensible.** "The system cannot text someone at 4am" is a
statement about a pure function with a test asserting it, not a statement about
whether every call site remembered to check.

**It concentrates test effort where it pays.** The value of a test is
proportional to the cost of the behaviour being wrong. That cost is concentrated
in ~1,400 lines of core, so coverage thresholds are enforced there
(80/80/75/80; currently 99/100/93/99) and nowhere else. Outer layers are covered
by the type checker, the production build, and the boundary tests.

## Consequences

- Server actions must fetch data *before* calling into core, then act on the
  result. Slightly more code at the call site; the trade is deliberate.
- Adding a rule that needs data the caller doesn't already have means threading
  a parameter through. The friction is the feature — it makes an I/O dependency
  in a compliance rule a visible decision rather than an accident.
- Two exemptions are recorded in the boundary test: `core/secretBox.ts` reads
  `CREDENTIAL_SECRET` (see [ADR-0003](0003-credential-encryption-at-rest.md)),
  and `core/` imports `domain/types` and `domain/stateTimezone` for type
  declarations and reference tables, which carry no behaviour.
