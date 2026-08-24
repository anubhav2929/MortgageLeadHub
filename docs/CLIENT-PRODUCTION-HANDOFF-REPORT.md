# Equity Flow Group CRM production handoff

**Prepared:** August 24, 2026  
**Website:** https://www.equityflowgroup.com

## What was delivered

MortgageLeadHub is deployed as a phone-transfer-first mortgage CRM. It combines public intake, lead assignment, role-gated work queues, calling and sequential dial lists, contextual AI qualification, deterministic transfer decisions, callback scheduling, exactly-two callback SMS policy, email lifecycle tracking, signed provider webhooks, consent/suppression enforcement, SEO, privacy-limited analytics, and operational diagnostics.

The application does not treat a configured API key as proof that a business channel is legally or operationally live. Admin readiness panels distinguish configured, verified, degraded, disabled, and externally awaiting approval states.

## Calling center

Operators can select up to 50 authorized contacts from the Leads page and create an ordered call list. Officer mode advances with **Dial next**; Admin may use automatic sequential mode only after the feature flag and approved-number UAT. Each contact is rechecked immediately before dialing for consent, suppression, quiet hours in the borrower timezone, attempt limits, terminal status, licensing, assignment, and duplicate active calls.

The Vapi workflow uses three bounded assistants:

1. Qualification asks exactly one server-selected unanswered question at a time.
2. Routing explains only the deterministic server decision.
3. Transfer/Callback obtains consent, waits for the licensed officer, sends the approved summary before bridging, or books a callback when the officer is unavailable.

Admin can tune endpointing wait, interruption words/voice threshold, backoff, voice, model, maximum duration, signed webhook credential, and central transfer fallback. Answers are stored as evidence-backed candidates and do not overwrite verified lead facts.

## Callback and messaging behavior

The default callback policy uses 30-minute slots, a 10-minute buffer, 30-minute lead time, a 14-day horizon, immediate confirmation, and one reminder 15 minutes before the callback. Admin can edit the policy and approved templates.

The worker rechecks consent, STOP/suppression, quiet hours, cancellation, duplicate idempotency, and appointment start time immediately before send. A late worker cannot send a reminder after the callback starts. Operator timelines show queued, sent, delivered, failed, or suppressed outcomes.

## Access and security

Admin, Compliance, Officer, and Read-only roles have distinct server-enforced capabilities. Officers only receive assigned or legally eligible unassigned leads. Read-only views mask restricted data and cannot mutate. Admin provider values are AES-256-GCM encrypted; secret values are never returned to the browser. Authenticator MFA is available for every account and should be enrolled for Admin and Compliance before staff launch.

Provider callbacks use native signatures: Telnyx Ed25519, Twilio request signatures, Resend/Svix signatures, and Vapi HMAC/custom credentials. Replay and duplicate events are idempotently rejected or settled once.

## SEO and AI-search work

The public site includes unique metadata and canonicals, a public-only sitemap, crawl rules, manifest, Open Graph image, Organization and FinancialService structured data, Article and Breadcrumb structured data, answer-first mortgage guides, calculators, visible sources and limitations, and a contextual internal-link graph spanning the homepage, resources, refinance, cash-out, home-equity options, and calculators.

Private CRM, authentication, borrower-status, and API routes are excluded from indexing. GA4 and Meta load only after consent and accept generic funnel events; property, mortgage, credit, transcript, qualification, and contact data are prohibited by schema.

“AI SEO” is implemented as search/answer-engine retrievability: server-rendered answers, clear headings, concise definitions, related-question links, matching structured data, source attribution, review dates, and consistent canonical URLs. No unsupported promise of ranking or AI Overview inclusion is made.

## Customer setup

At final deployment, Vapi and NVIDIA authenticated successfully. Telnyx, its signed webhook key/profile, Resend, OpenAI, and Anthropic were not configured. Vapi's custom webhook credential was also absent; configure it before the signed-webhook UAT if the account supports custom credentials.

1. Sign in as Admin and enroll authenticator MFA under **Admin → Users**.
2. Enter integrations under **Admin → Integrations** and use **Test connection**.
3. Set Vapi, Telnyx, Resend, Cron, GA/Search Console, Meta, and company/NMLS values.
4. Configure Telnyx signed primary `/api/webhooks/telnyx` and failover `/api/webhooks/telnyx/failover` endpoints.
5. Configure Resend delivery `/api/webhooks/delivery/resend` and inbound `/api/webhooks/resend-inbound` endpoints.
6. Configure one scheduler for `/api/cron/cadence` and `/api/cron/process-webhooks` with the Cron bearer secret.
7. Complete 10DLC, sender-domain, Reddit commercial, credit legal/vendor, GA/Meta, and Search Console ownership tasks.
8. Run approved-number UAT and enable feature flags one at a time.
9. Submit `/sitemap.xml` in Search Console and inspect the homepage, guides, and calculators.

## Acceptance evidence

- Production database backup self-verified before migration: 29 tables and 2,228 rows.
- Additive migrations `001`–`006` present; normalized reconciliation completed.
- 571 automated tests pass across 47 files.
- TypeScript, ESLint, webpack build, Vercel production build, and dependency audit pass.
- Production dependency audit reports zero known advisories.
- No live borrower/provider action and no data deletion occurred during deployment.

The detailed technical evidence, role matrix, and remaining external gates are in `docs/CRM-FINAL-DEPLOYMENT-AUDIT.md` and `security_best_practices_report.md`.
