# MortgageLeadHub final production audit

**Audit date:** August 24, 2026  
**Release classification:** Production code deployed; live outreach remains configuration- and UAT-gated  
**Production host:** https://www.equityflowgroup.com

## Executive result

The two-pass audit traced each CRM feature from visible control through authorization, validation/policy, persistence, provider, webhook/reconciliation, audit trail, and operator-visible result. The critical and high code defects in the earlier audit are remediated. Production data was backed up before schema changes; migrations `001`–`006` were applied idempotently; the legacy snapshot was copied into normalized tables; and the final application retains snapshot-authoritative reads until the normalized comparison window is approved.

No lead, message, consent, document, credential, account, or audit record was deleted. No seed, reset, live credit pull, Reddit post, SMS, email, or phone call was executed during release work.

## Completion classification

### Complete and active in code

| Area | Verified implementation |
| --- | --- |
| Authentication | SQL-backed identity lifecycle, hashed expiring invite/reset tokens, session revocation, lockout, rate limiting, 12-character password minimum, common/breached-password screening, optional TOTP with one-time recovery codes. |
| Access control | Server-scoped Admin, Compliance, Officer, and Read-only permissions; officer assignment/licensing checks; child-record binding; UI hides controls the role cannot execute. |
| Persistence safety | Awaited saves, revision-locked conflict merge, additive migrations, durable webhook inbox/outbox, advisory leases, and non-destructive release scripts. |
| Calling center | Up to 50 selected leads, manual next or admin-only automatic sequential mode, one active call, pause/resume/skip/cancel, policy recheck before every dial, lifecycle reconciliation, and audited queue operations. |
| Vapi orchestration | Server-owned context snapshot, one-question cadence, deterministic decisions, squad handoffs, bounded tool state, speaking-plan settings, warm transfer, callback fallback, and signed/idempotent webhook processing. |
| Callback messaging | UTC storage plus borrower IANA timezone, configurable slots/buffers/horizon, immediate confirmation plus one eligible reminder, suppression/quiet-hour/start-time recheck, durable jobs, cancel/reschedule, and operator board. |
| Telnyx/Twilio | Runtime credentials, Telnyx Ed25519 primary/failover ingestion, Twilio signature validation, replay/idempotency controls, STOP/START/HELP, provider idempotency, and short-lived TeXML capability tokens. |
| Resend/email | Inquiry confirmation, invites, resets, manual/cadence email, delivery/bounce/inbound signed webhooks, durable logging, and diagnostics. |
| Admin configuration | Encrypted DB-first configuration for Vapi, Telnyx, Twilio, Resend, OpenAI, Anthropic, NVIDIA, Reddit, RentCast, iSoftpull, GA4, Search Console, Meta, Cron, platform URL, NMLS, and launch gates. Values resolve on the next request without a redeploy. |
| SEO and AI-search readiness | Per-page metadata/canonicals, crawl rules, sitemap, manifest, Open Graph, Organization/FinancialService/Article/Breadcrumb JSON-LD, public guide architecture, contextual internal links, answer-first content, sources, review dates, and noindex on private/status/auth surfaces. |
| Analytics privacy | Explicit consent, strict generic event allowlist, no borrower/loan parameters, source-URL allowlist, shared browser/server Meta event ID, GA privacy limits, and server token kept out of request URLs. |
| Security | Verified database TLS, nonce-based script CSP, private document fail-closed path, content/magic-byte/size/scanner validation, sensitive-text redaction, encrypted provider control URLs, no production demo passwords, and disabled lead deletion pending retention policy. |

### Implemented but disabled until Admin configuration or acceptance evidence

| Feature | Activation requirement |
| --- | --- |
| Vapi squads and automatic warm transfer | Vapi fields, signed webhook credential, licensed officer/central destination, approved-number UAT, then enable flags. |
| Callback scheduling and automated power dialer | Provider configuration, scheduler, approved-number concurrency/failure UAT, then enable flags. |
| Telnyx SMS | API key/number/public signing key, signed webhooks, approved 10DLC campaign. |
| Resend | API key, verified sender domain, from address, inbound and delivery webhook secrets. |
| Reddit direct publish | Written commercial approval, OAuth connection, human preview/rule confirmation, then feature flag. |
| iSoftpull | Vendor credentials plus `CREDIT_LIVE_APPROVED=true` only after counsel approval and sandbox UAT. |
| Meta CAPI | Dataset/token/reviewed API version, consent-denial payload UAT, then feature flag. |
| Free valuation chain | Evidence-source configuration and customer benchmark; RentCast remains fallback and insufficient evidence remains an explicit result. |

### External/account-owner work still required

Code cannot complete these truthfully:

1. Enter and test Vapi, Telnyx, Resend, Cron, GA, Meta, Reddit, RentCast, and approved credit credentials in **Admin → Integrations**.
2. Complete Telnyx 10DLC approval and configure signed primary/failover webhook URLs.
3. Configure one scheduler at the required frequency. The current Vercel Hobby plan cannot register sub-daily cron frequency; use Vercel Pro or an external scheduler with `Authorization: Bearer <CRON_SECRET>`.
4. Perform live UAT only on approved numbers for answered/no-answer/voicemail, warm transfer summary-before-bridge, callback fallback, exactly-two SMS behavior, STOP between booking/reminder, and duplicate-worker execution.
5. Enroll Admin and Compliance accounts in authenticator MFA and store recovery codes.
6. Verify the sender domain, Search Console property, GA/Meta business assets, final NMLS/company identity, and business-account ownership.
7. Obtain written Reddit commercial approval and credit counsel approval before enabling their gates.
8. Approve retention/legal-hold rules before implementing any permanent borrower-record deletion. Deletion remains disabled to preserve evidence and prevent partial erasure.

### Production provider diagnostics at final deploy

| Capability | Final observed state |
| --- | --- |
| Database | Connected with verified Supabase PostgreSQL TLS |
| Vapi | Configured; API authenticated successfully |
| Vapi custom webhook credential | Not configured; shared-secret HMAC remains available |
| NVIDIA AI | API authenticated successfully |
| Telnyx | Not configured |
| Telnyx signed webhook key/profile | Not configured |
| Resend outbound/inbound/delivery | Not configured |
| OpenAI / Anthropic | Not configured; NVIDIA is the available model provider |

## Database release evidence

| Control | Result |
| --- | --- |
| Pre-migration backup | AES-256-GCM encrypted logical backup created from a repeatable-read transaction. |
| Backup self-verification | Pass: decrypted and checksum-verified inside the production environment before download. |
| Backup inventory | 29 public tables, 2,228 rows, 5,774,439 encrypted bytes. |
| Backup checksum | `f6015128f202ea1bbc9a08126892d54c016938bbb5682485af94f3fc374560ad` |
| Migrations already present | `001`, `002`, `003` |
| Applied in this release | `004_voice_callback_reddit_records`, `005_dialing_sessions`, `006_auth_action_tokens` |
| Final migration set | `001` through `006`, confirmed by the database. |
| Snapshot reconciliation | Idempotent normalized copy completed; primary lead/person/attempt/conversation counts cannot be lower than the source snapshot. |
| Destructive SQL | None. Migrations create/alter/add/index/upsert only. |

The encrypted backup is stored locally under ignored `.backups/` storage and excluded from Vercel uploads. It requires the production bootstrap key for recovery.

## Role matrix

| Capability | Admin | Compliance | Officer | Read-only |
| --- | --- | --- | --- | --- |
| All leads / raw PII | Yes | Yes | Assigned or eligible unassigned only | Masked only |
| Call/message center | Yes | Oversight | Authorized leads | No |
| Edit lead / call / close | Yes | No | Assigned leads | No |
| Notes/tasks | Yes | Yes | Assigned leads | No |
| Suppression / kill switch / audit | Yes | Yes | No | No |
| Users, officers, referrals, system settings, provider secrets | Yes | View where applicable | No | No |
| Cadence edit | Yes | Approval/oversight only | No | No |
| Automatic sequential dialer | Yes after flag/UAT | No | Manual-next lists only | No |

Every mutation is enforced server-side; UI gating is an additional usability control, not the security boundary.

## Verification evidence

| Check | Result |
| --- | --- |
| TypeScript | Pass |
| ESLint | Pass, zero warnings |
| Vitest | 47 files, 571 tests passed |
| Next.js webpack production build | Pass, 44 application routes plus proxy |
| Vercel Turbopack production build | Pass, 44 application routes plus proxy |
| Production dependency advisories | 0 known vulnerabilities |
| Provider calls during release | None |
| Data deletion/reset/seed | None |

## Release decision

The CRM application and database schema are deployable and are deployed. It is **not accurate to call every external channel live** until the account owner enters credentials, completes carrier/legal approvals, configures the scheduler, and records live UAT. Feature flags and fail-closed checks preserve that boundary.
