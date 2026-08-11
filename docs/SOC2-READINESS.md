# SOC 2 readiness — engineering audit

Written as a full-stack review of the codebase as it stands, mapped to the
Trust Services Criteria an auditor actually tests. Findings are ordered by
what would block a Type II report, not by how hard they are to fix.

**Scope note:** SOC 2 is ~70% organisational (policies, vendor management,
access reviews, incident response, background checks) and ~30% technical. This
document covers only the technical half. A clean codebase does not produce a
report on its own.

**Status legend:** ✅ in place · ⚠️ partial · ❌ missing

---

## Executive summary

The compliance-critical *business* logic is in unusually good shape for this
stage: PolicyGate is a pure, exhaustively tested decision layer; credentials
are encrypted at rest with an environment-held key; the architecture boundary
is enforced by a test rather than a convention. That is real, and it is the
part most teams get wrong.

The gaps are in the **infrastructure and operations** layer, and they cluster
around three things an auditor will go straight to: **durable audit logging,
data lifecycle, and access controls on the data store**. None are hard; all
are unbuilt.

**Blocking for Type II: 4 findings. Significant: 5. Advisory: 6.**

---

## Blocking findings

### B1 — Audit logs are mutable and share the application's storage ❌
`CC7.2`, `CC7.3`

`db.auditLogs` is a plain array inside the same JSON blob as the business
data (`src/domain/store.ts:53`). Anyone who can write application data can
rewrite the audit trail, and a corrupted save loses both together. An auditor
will ask "can a privileged user erase evidence of their own action?" — today
the answer is yes.

**Fix:** append-only audit storage separate from the application store —
a dedicated table with INSERT-only grants, or a log sink (CloudWatch,
Datadog, S3 with object lock). Retention ≥ 1 year.

### B2 — No retention or deletion policy for borrower PII ❌
`P4`, `CC6.5`

Leads, transcripts, and consent records accumulate indefinitely. There is no
scheduled purge, no per-record retention clock, and `deleteLeadAction` (which
I added this session) is a manual admin action, not a policy. Mortgage leads
contain financial PII; "we keep everything forever" fails both SOC 2 privacy
criteria and state privacy law (CCPA/CPRA gives Californians deletion rights,
and you operate in CA).

**Fix:** a documented retention schedule with an automated job. `intakeDrafts`
already has `DRAFT_RETENTION_DAYS` — extend that pattern to leads and
transcripts.

### B3 — Single-blob persistence has no row-level access control or integrity ❌
`CC6.1`, `A1.2`

Everything is one JSONB row read and rewritten wholesale
(`src/domain/persistence.ts`). Consequences an auditor will flag:
- No least-privilege possible at the data layer — any DB credential reads all
  borrower PII.
- Concurrent instances overwrite each other (last-write-wins, no locking).
- `persist()` is fire-and-forget: a UI success can precede a failed write.
- No point-in-time recovery of individual records.

**Fix:** this is the normalisation work already noted in `ARCHITECTURE.md`.
Start with `leads`, `people`, `contactAttempts`, `auditLogs`.

### B4 — No backup, recovery, or availability evidence ❌
`A1.2`, `A1.3`

Nothing documents backup frequency, retention, restore procedure, or RTO/RPO,
and no restore has ever been tested. Auditors ask for evidence of a *tested*
restore, not a backup configuration screenshot.

**Fix:** enable Neon/Vercel Postgres PITR, document RTO/RPO, perform and
record one restore test.

---

## Significant findings

### S1 — Borrower PII in application logs ⚠️
`CC6.1`, `P8`

Simulated-send paths log full phone numbers, email addresses, and message
bodies (`adapters/sms.ts:99`, `email.ts:21`, `voice.ts:39`,
`voiceAgent.ts:71`). These reach Vercel's log drain, which is a third-party
system with its own retention.

Mitigating: these fire only on the *simulated* path. But that is the path a
misconfigured production deployment silently falls back to — exactly when
you'd least want PII in logs.

**Fix:** redact to last-4 (`+1•••••4567`) and drop message bodies. Cheap, and
safe to do without touching logic.

### S2 — No rate limiting anywhere ❌
`CC6.6`, `CC6.7`

No rate limiting on `/login` (credential stuffing), `submitIntakeAction` (the
one unauthenticated write path — spam/resource exhaustion), or the webhook
routes. The per-account lockout in `loginAction` (5 attempts) helps against a
targeted attack but not against spraying across many accounts.

**Fix:** Vercel WAF rate rules, or an IP+route limiter at the edge.

### S3 — Session lifetime is 30 days with no rotation or revocation UI ⚠️
`CC6.1`, `CC6.3`

Cookie flags are correct (`httpOnly`, `sameSite: lax`, `secure` in
production — `session.ts:62`). But a 30-day TTL with no rotation on privilege
change, no idle timeout, and no way for an admin to revoke another user's
sessions is longer than an auditor will accept for a system holding financial
PII.

**Fix:** shorten to ~8h idle / 7d absolute, rotate the token on login, add
"sign out everywhere".

### S4 — Security headers are incomplete ⚠️
`CC6.6`

Present (`next.config.ts`): `X-Content-Type-Options`, `X-Frame-Options`,
`Referrer-Policy`, `Permissions-Policy`. **Missing:** `Content-Security-Policy`
and `Strict-Transport-Security`.

CSP is the meaningful gap — without it there's no defence-in-depth against
XSS reaching the DOM.

**Fix:** add HSTS immediately (one line, zero risk). Add CSP in report-only
mode first, then enforce. *Do not enforce CSP before a demo* — a wrong
directive blanks the page.

### S5 — No dependency or secret scanning in CI ❌
`CC7.1`, `CC8.1`

CI runs typecheck, lint, test, build — no `npm audit`, no Dependabot, no
secret scanning. Auditors ask how you learn about a vulnerable dependency.

**Fix:** enable Dependabot + GitHub secret scanning (free, ~10 min), add
`npm audit --audit-level=high` to CI.

---

## Advisory

| # | Finding | Criterion |
| --- | --- | --- |
| A1 | Seeded demo users with a **shared known password** ship in the default database. Must be removed before real data. | `CC6.1` |
| A2 | No MFA for admin accounts. Expected for privileged access to financial PII. | `CC6.1` |
| A3 | No formal access review — nothing records who reviewed user access and when. | `CC6.2`, `CC6.3` |
| A4 | No alerting/monitoring. `INTEGRATION_ALERT` tasks are in-app only; nobody is paged. | `CC7.2` |
| A5 | Encryption at rest depends on the provider default; not documented as a control. Field-level encryption exists only for credentials, not borrower PII. | `CC6.1` |
| A6 | No documented change-management: no PR approval requirement, no branch protection. CI exists but isn't enforced as a merge gate. | `CC8.1` |

---

## What is already strong

Worth stating plainly, because these are genuine controls an auditor will
credit:

- ✅ **Credentials encrypted at rest** — AES-256-GCM, scrypt-derived key held
  outside the database (`core/secretBox.ts`, ADR-0003). Tamper-detecting, and
  the store refuses plaintext fallback.
- ✅ **RBAC enforced in one place** — `core/rbac.ts`, used by both server
  actions and UI, with 20 tests written as "what must a role never do".
- ✅ **Compliance decisions are auditable and explainable** — every PolicyGate
  evaluation persists its inputs and rule codes (`db.policyDecisions`).
- ✅ **Webhook authentication** — HMAC signature verification with
  constant-time comparison and replay-window rejection (`core/auth.ts`).
- ✅ **Least-privilege override design** — the admin outreach override cannot
  relax consent, suppression, or opt-out, and automation never inherits it.
- ✅ **Enforced architecture** — `tests/architecture.test.ts` fails the build on
  boundary violations, including any adapter reading `process.env` directly.
- ✅ **Secrets never logged** — credential audit entries record key *names* and
  outcomes, never values.

---

## Recommended sequence

**Before real borrower data (non-negotiable):** A1 (remove demo credentials),
S1 (redact PII from logs), B4 (backups), S3 (session lifetime).

**Before a Type II window opens:** B1 (immutable audit log), B2 (retention),
S2 (rate limiting), S5 (dependency scanning), A2 (admin MFA).

**Next quarter:** B3 (normalise persistence) — the largest item, and the one
that unlocks least-privilege at the data layer.

**Zero-risk quick wins (≤ 1 hour total, safe to do today):** HSTS header,
Dependabot, GitHub secret scanning, branch protection, PII redaction in the
simulated-send logs.

---

## Honest scoping

If someone tells you this codebase is "SOC 2 compliant", that is not a
meaningful statement — SOC 2 certifies an *organisation's controls over a
period of time*, not a repository. What this audit supports is a narrower,
accurate claim:

> The application's compliance-critical logic is isolated, tested, and
> auditable, and the technical control gaps are identified with a remediation
> plan.

The blocking findings above are the difference between that sentence and a
clean Type II report. Budget the organisational half separately — it is the
larger lift and cannot be closed by engineering.
