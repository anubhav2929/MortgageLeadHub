# Security best-practices report

**Reviewed:** August 24, 2026  
**Scope:** Next.js/React/TypeScript application, authentication, authorization, server actions, providers, webhooks, persistence, documents, voice, analytics, migrations, and release controls.

## Result

No open Critical or High code vulnerability was found in the final pass. All Critical/High defects from the initial audit were remediated and regression-tested. The remaining findings are controlled rollout or policy dependencies and do not justify weakening the current fail-closed behavior.

## Remediated findings

1. **Critical — horizontal lead authorization:** fixed with centralized capability checks, server-scoped queries, assignment/licensing enforcement, child-record binding, final-object redaction, and UI gating. Direct actions remain the authoritative boundary.
2. **Critical — split production identity authority:** fixed with one SQL identity repository for create/invite/activate/login/reset/change/deactivate plus immediate SQL session revocation.
3. **Critical — stale snapshot overwrite/unawaited persistence:** all saves are awaited; PostgreSQL row locking and revision-aware merge preserve unrelated current records. Operational records use normalized tables and durable queues.
4. **High — unsafe partial lead deletion:** permanent deletion is disabled until a counsel-approved retention/legal-hold workflow exists. The product cannot make a false “permanently deleted” promise.
5. **High — derived financial-data disclosure:** restricted valuation, equity, credit, and quality fields are projected out for unauthorized roles.
6. **High — fabricated credit fallback:** production credit fails closed without credentials, consent, permissible purpose, and `CREDIT_LIVE_APPROVED=true`; no score is invented or persisted.
7. **Medium — public-reference status access:** private, hashed, expiring status tokens are required; public-reference fallback was removed.
8. **Medium — reusable TeXML query secret:** replaced with short-lived, single-use, hashed per-call capability tokens.
9. **Medium — provider logs containing PII:** simulation/failure logs record correlation identifiers and classifications, not destinations, message bodies, or transcripts.
10. **Medium — weak privileged authentication controls:** password minimum is 12 characters, common/breached-password screening is present, lockout/rate limits are enforced, TOTP secrets are encrypted, recovery codes are one-time hashes, and enabled users cannot create a session without the second factor.
11. **Medium — legacy shared-secret carrier webhooks:** Telnyx uses Ed25519 with replay bounds; Twilio uses `X-Twilio-Signature`; Resend uses Svix signatures; Vapi uses HMAC/custom credentials. Legacy Telnyx routes return 410.
12. **Medium — browser persistence of intake PII:** persistent `localStorage` contains only a random draft identifier; incomplete form data is tab-scoped and cleared at completion/discard.
13. **Medium — uploaded inline data:** production upload fails closed unless authenticated private object storage and malware scanning are configured; MIME, magic bytes, size, filename, and attachment-only download are enforced.
14. **Medium — unverified database TLS:** every production PostgreSQL path uses certificate verification and requires the Supabase CA when applicable.
15. **Medium — analytics data leakage:** only enumerated generic events pass strict validation; consent is required; URLs are origin/path allowlisted; business/borrower parameters are not accepted; the Meta token is sent in the POST body rather than URL.

## Open controlled findings

### SEC-001 — normalized authoritative-read rollout is not enabled

**Severity:** Medium  
**Status:** Controlled, feature locked off

The additive schema is migrated and the snapshot has been reconciled into normalized tables. The current compatibility snapshot remains authoritative while comparison evidence accumulates. `normalizedReads` cannot be enabled from Admin. This avoids an unverified cutover; it is not a hidden fallback.

**Close condition:** zero-difference reconciliation over the agreed observation period, sampled record review, rollback rehearsal, then a dedicated authoritative-read release.

### SEC-002 — retention and legal-hold policy requires counsel approval

**Severity:** Medium  
**Status:** Fail closed

The application does not permanently delete lead graphs because no approved retention classes, litigation holds, identity-verification workflow, or consent/suppression preservation schedule has been supplied.

**Close condition:** approved policy, full child/object fixture tests, immutable deletion receipt, and verified backup/restore drill.

### SEC-003 — pre-consent draft remains sensitive in tab storage

**Severity:** Low  
**Status:** Reduced and time-limited

Draft PII uses `sessionStorage`, not persistent `localStorage`, and the server draft is write-only from the public client with bounded input and retention cleanup. A script running in the same origin could still read the tab copy.

**Close condition:** move recovery state to an HttpOnly proof-of-possession flow or remove browser draft recovery entirely.

### SEC-004 — style CSP retains `unsafe-inline`

**Severity:** Low  
**Status:** Accepted compatibility follow-up

Executable scripts use a request nonce and `strict-dynamic`; styles retain `unsafe-inline` for framework compatibility. `frame-ancestors 'none'`, `object-src 'none'`, HSTS, nosniff, referrer policy, and permissions policy remain enforced.

**Close condition:** report-only style CSP inventory followed by hash/nonce-compatible styling and removal of style `unsafe-inline`.

## Production data-change controls

- An AES-256-GCM encrypted repeatable-read backup was created and self-verified before migration: 29 tables, 2,228 rows, checksum `f6015128f202ea1bbc9a08126892d54c016938bbb5682485af94f3fc374560ad`.
- Migrations `001`–`006` are additive and idempotent. No `DROP TABLE`, truncation, reset, seed, credential rotation, or record deletion was executed.
- The temporary bearer-authenticated maintenance route and maintenance build bypass were removed before the final production deploy.
- Local backup artifacts are ignored by Git and Vercel uploads.

## Verification

- TypeScript: pass.
- ESLint: pass, zero warnings.
- Vitest: 47 files, 571 tests.
- Next.js webpack build: pass, 44 application routes plus proxy.
- Vercel production build: pass, 44 application routes plus proxy.
- Production dependency audit: zero known advisories.

External approval evidence—10DLC, sender-domain ownership, Reddit commercial authorization, credit permissible purpose, business-account ownership, and approved-number UAT—must be recorded by the relevant account owners.
