# MortgageLeadHub — Product & Engineering Build Specification (PDR)

**Version 2.0 · Supersedes the Software Engineering Plan v1.0 as the technical source of truth**
**Client:** Aldrich · **Delivery:** Easybusiness by Flewway · **PM:** Anubhav
**Audience:** engineers implementing ticket-by-ticket, reviewers, and compliance.

---

## 0. How to use this document

This document is written to be implementable **without prior context on the
product**. Every feature section contains: purpose → data it owns → API
contract → exact business logic (pseudocode) → edge cases → acceptance tests.
**If a decision is not recorded here, raise it rather than deciding it
locally** — most of this domain is regulated, and an undocumented choice in
consent, retention, or contact timing is a compliance finding rather than a
style preference.

Build order is **strictly sequential by ticket ID**. Do not parallelise unless
the ticket says `PARALLEL-SAFE`.

**Definition of done, per ticket:**

- Implement only that ticket; do not modify files outside its file list.
- Write the ticket's acceptance tests first, then make them pass.
- `npm run verify` (typecheck, lint, tests, build) is green before review.
- Ambiguities are raised on the ticket, not resolved by assumption.

### 0.1 Open conflict to resolve before Phase 2

The Client Confirmation states a production window of **18–30 Aug 2026**. The MVP Delivery Plan states go-live **18 Sep 2026**. These cannot both be true. This spec is sequenced by dependency, not date. **Anubhav must re-baseline one document with Aldrich before Phase 2 vendor spend begins.** Recommended: keep the Aug window for a *staging/UAT demo with test numbers*, and Sept 18 for *real consumer intake*, since real intake is gated on attorney sign-off and vendor DPAs which are outside our control.

---

## 1. Engineer persona (adopt this before writing any code)

> You are a senior full-stack engineer who has shipped two regulated-industry lead platforms (mortgage and insurance). You have been burned personally by a TCPA complaint caused by a race condition in a suppression check, so you treat consent and suppression as the hot path, not a side table. You are allergic to premature infrastructure: you will not add Redis, Kafka, microservices, or a separate frontend deploy for a system whose realistic peak is 500 leads/day. You ship a monolith with clean internal seams. You write the state machine down before you write the handler. You believe an `unknown` value is data and `null` is a bug. You never let an LLM be the system of record for anything.

**Decision filters — apply to every choice, in this order:**

1. **Compliance filter** — Can this action contact a human? Then suppression + consent + quiet hours are checked in the *same transaction* as the send, not before it.
2. **Auditability filter** — If a regulator asks "why did this SMS go out at 8:04pm on Sep 3," can I answer from one query on one table? If not, redesign.
3. **Leanness filter** — Does this add a new deployable, a new managed service, or a new language? If yes, is there a Postgres-shaped solution instead? Default to Postgres.
4. **Reversibility filter** — Is this an outbound side effect (call, SMS, export)? Then it must be idempotent, keyed, and logged before it fires.
5. **Dumb-model filter** — Could a weaker model implement this from the spec alone? If the logic lives in my head, write it into the spec first.

---

## 2. Nature of the software

MortgageLeadHub is **not a CRM and not a chatbot**. It is a **compliance-gated workflow engine with a conversational data-collection front-end**.

| Property | Consequence for architecture |
|---|---|
| **Regulated outbound contact** (TCPA/DNC/quiet hours) | Every outbound action passes a single `PolicyGate` service. No provider SDK is ever called directly from a route handler. |
| **Event-sourced by obligation** | The lead timeline is append-only and is the legal record. Mutable lead fields are a *projection*, rebuildable from events. |
| **Low write volume, high consequence** | Postgres does everything: store, queue, lock, audit. No Redis, no Kafka. |
| **Human is the terminal decision-maker** | Every automated path has an escalation exit. Automation can be paused globally by a kill switch. |
| **AI is an extractor, never an authority** | LLM output lands in a `field_candidates` staging area with confidence + provenance. Promotion to the lead profile is rule-based, not model-based. |
| **Bursty, latency-tolerant work** | Async job queue (`pg-boss`) for all outreach; HTTP handlers stay under 300ms. |

### 2.1 Core functions (the whole system, exhaustively)

1. **Capture** — consented intake of a refinance or equity inquiry.
2. **Gate** — decide, per channel, per moment, whether contact is legally permitted.
3. **Engage** — attempt contact on the permitted channel within SLA, with retries and fallback.
4. **Qualify** — conversationally collect structured facts, deferring sensitive topics.
5. **Extract** — turn transcripts into typed fields with provenance, confidence, and explicit unknowns.
6. **Package** — assemble a 1003-aligned pre-application profile with a completeness score.
7. **Route** — assign to an eligible licensed officer and obtain acknowledgement.
8. **Hand off** — export an approved payload to LOS/CRM.
9. **Suppress** — honour opt-out/DNC/complaint instantly and globally, forever.
10. **Observe** — audit every access, export, routing decision, and contact attempt.
11. **Administer** — manage officers, coverage, cadences, prompts, disclosures.

Anything not on this list is out of MVP scope and requires a change request.

---

## 3. Architecture

### 3.1 Stack (locked — do not substitute)

| Layer | Choice | Why (leanness filter) |
|---|---|---|
| App | **Next.js 15, App Router, TypeScript strict** | One deployable serves public forms, officer workspace, and API routes. |
| DB | **PostgreSQL 16** (Neon or Supabase) | Relational integrity + JSONB + row locks + queue in one service. |
| ORM | **Prisma** | Migrations are reviewable diffs, and the typed client catches schema drift at compile time. |
| Queue | **pg-boss** | Postgres-backed. Retries, scheduling, dead-letter, exactly-once-ish. No Redis. |
| Worker | **Separate Node process, same repo** (`apps/worker`) | Long jobs must not run in serverless request context. |
| Auth | **Auth.js (NextAuth) v5**, credentials + TOTP | Individual accounts, no shared logins. Sessions in DB, revocable. |
| SMS/Voice | **Twilio** (adapter-isolated) | Programmable Voice + Messaging + STOP webhooks in one vendor. |
| Voice AI | **Vapi** or **Retell** (adapter-isolated, Phase 3) | Swappable behind `VoiceAgentAdapter`. |
| LLM | **Anthropic API, `claude-sonnet-4-6`**, tool-use for structured output | Schema-constrained extraction. |
| Email | **Resend** | Already in the prototype. |
| Hosting | **Vercel** (web) + **Railway/Render** (worker) | Two boxes, not twelve. |
| Secrets | Platform secret store + `zod`-validated `env.ts` | Fail fast at boot on missing config. |
| Tests | **Vitest** + **Playwright** (critical paths only) | |

### 3.2 Repo layout

```
mortgageleadhub/
├─ apps/
│  ├─ web/                     # Next.js: public forms, officer workspace, API routes
│  └─ worker/                  # pg-boss consumer: outreach, cadence, extraction
├─ packages/
│  ├─ db/                      # prisma schema, migrations, seed, client singleton
│  ├─ core/                    # ⭐ ALL BUSINESS LOGIC — pure, no I/O, fully unit-tested
│  │   ├─ policy/              # PolicyGate: consent, suppression, quiet hours, DNC
│  │   ├─ leads/               # state machine, projections
│  │   ├─ cadence/             # cadence resolver
│  │   ├─ extraction/          # candidate→field promotion rules
│  │   ├─ package/             # 1003 mapping + completeness scoring
│  │   └─ routing/             # officer eligibility + assignment
│  ├─ adapters/                # thin provider wrappers, one file per vendor
│  │   ├─ sms/ voice/ voiceagent/ llm/ email/ los/
│  └─ shared/                  # zod schemas, types, error classes, env
└─ SPEC.md                     # this document
```

**Hard rule:** `packages/core` may not import from `adapters`, `db`, or `next`. It takes plain data in and returns plain data out. This is what makes the compliance logic testable without mocks. Violating it is an automatic review rejection.

### 3.3 Request → contact flow

```
Public form ──POST /api/intake──▶ IntakeService
                                   ├─ persist ConsentRecord (immutable)
                                   ├─ persist Lead + LeadEvent(LEAD_CREATED)
                                   └─ enqueue job: outreach.attempt (SLA delay)
                                                        │
                              ┌─────────────────────────▼──────────────────────┐
                              │ Worker: outreach.attempt                        │
                              │ 1. SELECT lead FOR UPDATE (row lock)            │
                              │ 2. PolicyGate.evaluate(lead, channel, now)      │
                              │    ├─ DENY → log OUTREACH_BLOCKED + reason      │
                              │    └─ DEFER → reschedule to next permitted slot │
                              │ 3. write ContactAttempt(PENDING, idempotency_key)│
                              │ 4. adapter.send()  ← only place a vendor is hit │
                              │ 5. commit                                        │
                              └─────────────────────────┬──────────────────────┘
                                                        ▼
                        Twilio webhook ──▶ /api/webhooks/twilio ──▶ append LeadEvent
                                                        │
                                       ┌────────────────┴───────────────┐
                                    STOP received                   call answered
                                       │                                │
                              Suppression.add(global)          Conversation session
                                       │                                │
                              cancel all pending jobs          transcript → extraction
                                                                        │
                                                          field_candidates → promotion
                                                                        │
                                                          1003 package → routing → officer
```

### 3.4 The two rules that prevent every serious incident

**Rule A — Single Gate.** `PolicyGate.evaluate()` is the *only* function permitted to authorise outbound contact. Adapters throw if not given a valid `PolicyDecision` token carrying a `decisionId` that is written to the audit log. Grep test in CI: no file outside `adapters/` may import a vendor SDK.

**Rule B — Lock before send.** Every outbound job takes `SELECT ... FOR UPDATE` on the lead row. Two workers can never double-dial or double-text the same person.

---

## 4. Data model

Prisma schema highlights. `packages/db/prisma/schema.prisma`.

### 4.1 Enums

```prisma
enum LeadState {
  NEW ATTEMPTING_CONTACT IN_CONVERSATION QUALIFYING
  READY_FOR_HANDOFF ASSIGNED ACKNOWLEDGED
  NURTURE STALE SUPPRESSED CLOSED_WON CLOSED_LOST
}
enum Channel        { VOICE SMS EMAIL }
enum ConsentScope   { CONTACT_VOICE CONTACT_SMS CONTACT_EMAIL RECORDING DATA_SHARING }
enum SuppressionReason { OPT_OUT_STOP DNC_LIST WRONG_PARTY COMPLAINT MANUAL LITIGATION }
enum AttemptOutcome { QUEUED SENT DELIVERED ANSWERED NO_ANSWER BUSY VOICEMAIL FAILED BLOCKED UNDELIVERED }
enum FieldStatus    { UNKNOWN CANDIDATE CONFIRMED VERIFIED CONFLICTED }
enum LoanIntent     { REFINANCE HOME_EQUITY CASH_OUT UNKNOWN }
enum Occupancy      { PRIMARY SECOND_HOME INVESTMENT UNKNOWN }
enum Role           { ADMIN COMPLIANCE OFFICER READ_ONLY }
```

### 4.2 Tables

**`Lead`** — the projection. `id`, `publicRef` (nanoid, used in URLs), `state`, `intent`, `sourceId`, `assignedOfficerId?`, `slaDueAt`, `firstContactAt?`, `lastContactAt?`, `completenessScore` (0–100), `createdAt`, `updatedAt`. Never store consent booleans here — derive them.

**`Person`** — `leadId`, `firstName`, `lastName`, `phoneE164` (indexed), `email`, `preferredContactWindow`, `timezone` (IANA, derived from property state; default from area code, `UNKNOWN` allowed). Separate from Lead so a co-borrower is a second `Person` with `role: CO_BORROWER`.

**`ConsentRecord`** — **immutable, append-only.** `id`, `leadId`, `personId`, `scope`, `granted` (bool), `disclosureVersionId`, `exactTextSnapshot` (TEXT — store the literal rendered text, not a pointer), `capturedAt`, `sourceUrl`, `ipAddress`, `userAgent`, `sessionId`, `formFingerprint`. **No UPDATE or DELETE allowed** — enforce with a Postgres trigger, not just discipline:

```sql
CREATE TRIGGER consent_immutable BEFORE UPDATE OR DELETE ON "ConsentRecord"
FOR EACH ROW EXECUTE FUNCTION raise_immutable();
```

Revocation is a *new row* with `granted = false`. Current consent = latest row per (personId, scope).

**`DisclosureVersion`** — `id`, `key` (e.g. `tcpa_sms_v3`), `version`, `bodyText`, `effectiveFrom`, `effectiveTo?`, `approvedBy`, `approvedAt`. Prompts and disclosures are change-controlled like code.

**`Suppression`** — `id`, `phoneE164` (**unique index**), `reason`, `scope` (`GLOBAL` | `CHANNEL`), `channel?`, `createdAt`, `expiresAt?` (null = forever), `evidenceEventId`. Keyed on phone, **not** lead — a person who opts out on one lead is suppressed across every future lead. This is the single most important table in the system.

**`LeadEvent`** — append-only timeline. `id`, `leadId`, `type` (string enum, ~40 values), `actorType` (`SYSTEM|OFFICER|BORROWER|PROVIDER|ADMIN`), `actorId?`, `channel?`, `payload` (JSONB), `occurredAt`, `recordedAt`, `correlationId`. Index `(leadId, occurredAt)`. This table answers the regulator.

**`ContactAttempt`** — `id`, `leadId`, `channel`, `direction`, `idempotencyKey` (**unique**), `policyDecisionId`, `providerMessageId?`, `outcome`, `attemptNumber`, `scheduledFor`, `startedAt?`, `endedAt?`, `recordingUrl?`, `transcriptId?`, `blockedReason?`.

**`PolicyDecision`** — `id`, `leadId`, `channel`, `decision` (`ALLOW|DENY|DEFER`), `reasons` (JSONB array of rule codes), `evaluatedAt`, `nextPermittedAt?`, `inputSnapshot` (JSONB). Written for **every** evaluation including denials. This is how you prove you *didn't* call someone.

**`Task`** — `id`, `leadId`, `type` (`FIRST_CONTACT|FOLLOW_UP|REVIEW_MISSING_FIELDS|ACKNOWLEDGE_HANDOFF|COMPLAINT`), `assigneeId?`, `dueAt`, `status`, `completedAt?`, `completedById?`.

**`CadencePlan`** / **`CadenceStep`** — plan scoped by `(sourceId?, stateCode?, intent?)`; step has `offsetMinutes`, `channel`, `templateId?`, `maxAttempts`, `stopOnOutcomes[]`. Data-driven, editable by admin — **no hardcoded cadences in code.**

**`ConversationSession`** — `id`, `leadId`, `contactAttemptId`, `promptVersionId`, `channel`, `status`, `startedAt`, `endedAt?`, `escalated` (bool), `escalationReason?`, `transcript` (JSONB turn array), `summary?`, `redactionApplied` (bool).

**`FieldCandidate`** — LLM output lands here, never directly on the profile. `id`, `leadId`, `fieldPath` (e.g. `property.occupancy`), `value` (JSONB), `confidence` (0–1), `sourceType` (`BORROWER_STATED|OFFICER_ENTERED|FORM|PROVIDER`), `sessionId?`, `transcriptTurnRefs` (int[]), `createdAt`, `promoted` (bool), `promotionRuleCode?`.

**`LeadField`** — the promoted, authoritative profile. `id`, `leadId`, `fieldPath` (**unique per lead**), `value` (JSONB), `status: FieldStatus`, `confidence`, `sourceType`, `collectedAt`, `lastUpdatedById`, `verificationStatus`, `supersededCandidateIds` (JSONB). `UNKNOWN` is a real row, not a missing row.

**`Officer`** — `userId`, `nmlsId`, `licensedStates` (string[]), `productTypes` (string[]), `dailyCapacity`, `currentLoad`, `activeHours` (JSONB), `isActive`.

**`AuditLog`** — `id`, `actorId`, `action`, `resourceType`, `resourceId`, `ipAddress`, `result` (`ALLOW|DENY`), `metadata` (JSONB), `at`. Separate from `LeadEvent`: `LeadEvent` is the *business* record, `AuditLog` is the *access* record. Every read of PII writes here.

**`ExportRecord`** — `id`, `leadId`, `destination`, `payloadHash`, `fieldsIncluded` (string[]), `exportedById`, `at`, `providerResponse` (JSONB).

### 4.3 Encryption

Column-level AES-256-GCM via a `packages/db/crypto.ts` helper on: `Person.phoneE164` (store a **blind index** HMAC alongside for lookup), `Person.email`, transcript bodies, `recordingUrl`. Key from secret store, versioned via `keyVersion` column so rotation is possible. **SSN, DOB, and full credit reports have no column in this schema at all** — the safest storage is none.

---

## 5. Lead state machine (single source of truth)

Implemented as a pure function in `core/leads/stateMachine.ts`. Any transition not in this table throws `InvalidTransitionError`.

| From | Event | To | Side effects |
|---|---|---|---|
| — | `LEAD_CREATED` | `NEW` | create `FIRST_CONTACT` task, enqueue outreach at SLA |
| `NEW` | `OUTREACH_ATTEMPTED` | `ATTEMPTING_CONTACT` | — |
| `ATTEMPTING_CONTACT` | `CONTACT_ANSWERED` | `IN_CONVERSATION` | open `ConversationSession` |
| `ATTEMPTING_CONTACT` | `MAX_ATTEMPTS_REACHED` | `NURTURE` | schedule cadence step |
| `IN_CONVERSATION` | `CONVERSATION_COMPLETED` | `QUALIFYING` | enqueue extraction |
| `QUALIFYING` | `PACKAGE_READY` | `READY_FOR_HANDOFF` | compute completeness, enqueue routing |
| `READY_FOR_HANDOFF` | `OFFICER_ASSIGNED` | `ASSIGNED` | create `ACKNOWLEDGE_HANDOFF` task, notify |
| `ASSIGNED` | `OFFICER_ACKNOWLEDGED` | `ACKNOWLEDGED` | stop all automation |
| `NURTURE` | `CADENCE_EXHAUSTED` | `STALE` | create human-review task |
| **any** | `OPT_OUT_RECEIVED` \| `DNC_MATCH` \| `COMPLAINT` \| `WRONG_PARTY` | `SUPPRESSED` | **cancel all queued jobs, add Suppression, terminal** |
| **any** | `OFFICER_TAKEOVER` | `ASSIGNED` | cancel automation, preserve timeline |
| `ACKNOWLEDGED` | `MARKED_WON` / `MARKED_LOST` | `CLOSED_*` | — |

`SUPPRESSED` is **terminal**. There is no transition out of it via automation; only an ADMIN with a written reason, which writes a `SUPPRESSION_LIFTED` audit entry.

---

## 6. PolicyGate — the compliance core

`packages/core/policy/policyGate.ts`. Pure function. **Build and test this ticket first; everything else depends on it.**

```ts
type GateInput = {
  now: Date;
  channel: Channel;
  phoneE164: string;
  personTimezone: string | 'UNKNOWN';
  propertyStateCode: string | null;
  consents: ConsentSnapshot[];      // latest per scope
  suppressions: SuppressionSnapshot[];
  attemptsToday: number;
  attemptsTotal: number;
  lastAttemptAt: Date | null;
  leadState: LeadState;
  killSwitchOn: boolean;
  cadenceStep: CadenceStep;
};

type PolicyDecision = {
  decision: 'ALLOW' | 'DENY' | 'DEFER';
  reasons: RuleCode[];       // e.g. ['QUIET_HOURS_LOCAL', 'ATTEMPT_CAP_DAILY']
  nextPermittedAt?: Date;    // required when DEFER
  decisionId: string;        // uuid, persisted, passed to the adapter
};
```

**Rules, evaluated in this exact order. First DENY wins and short-circuits.**

| # | Rule code | Condition | Result |
|---|---|---|---|
| 1 | `KILL_SWITCH` | global automation pause is on | DENY |
| 2 | `SUPPRESSED_GLOBAL` | any non-expired global suppression on phone | DENY |
| 3 | `SUPPRESSED_CHANNEL` | channel-scoped suppression matches | DENY |
| 4 | `NO_CONSENT` | no `granted=true` consent for the channel's scope | DENY |
| 5 | `CONSENT_REVOKED` | latest consent row for scope is `granted=false` | DENY |
| 6 | `LEAD_TERMINAL` | state ∈ {SUPPRESSED, CLOSED_*} | DENY |
| 7 | `OFFICER_OWNED` | state ∈ {ASSIGNED, ACKNOWLEDGED} and step is automated | DENY |
| 8 | `ATTEMPT_CAP_TOTAL` | attemptsTotal ≥ step.maxAttempts | DENY |
| 9 | `UNKNOWN_TIMEZONE` | timezone unresolved **and** channel ≠ EMAIL | **DEFER** to next 12:00 UTC-safe window, flag for human |
| 10 | `QUIET_HOURS_LOCAL` | local time outside 08:00–21:00 (configurable per state; strictest of federal/state applies) | DEFER to next window open |
| 11 | `ATTEMPT_CAP_DAILY` | attemptsToday ≥ 3 (config) | DEFER to next local morning |
| 12 | `MIN_SPACING` | now − lastAttemptAt < 4h (config) | DEFER |
| 13 | `WEEKEND_RULE` | state config forbids Sunday contact | DEFER |
| — | `ALLOW` | all passed | ALLOW |

**Deliberate design notes for the implementer:**
- Rule 9 exists because "we didn't know their timezone so we called at 6am" is an indefensible position. Unknown timezone must never resolve to "assume Eastern."
- Quiet hours use the **borrower's** local time derived from property state, falling back to phone area code, falling back to UNKNOWN. Never server time.
- The suppression check must read from the DB **inside the same transaction as the send**, not from a cached snapshot. A STOP that arrives 200ms before a queued send must win.
- Email is exempt from quiet hours but not from suppression or consent.

**Acceptance tests (must all exist as unit tests, no mocks needed):**
1. STOP recorded 1ms before evaluation → DENY `SUPPRESSED_GLOBAL`.
2. Valid consent, 20:59 local → ALLOW. 21:01 local → DEFER, `nextPermittedAt` = next day 08:00 local.
3. Timezone UNKNOWN + SMS → DEFER, never ALLOW.
4. Consent granted then revoked then granted again → ALLOW (latest row wins).
5. Lead `ASSIGNED` + automated cadence step → DENY `OFFICER_OWNED`.
6. Kill switch on → DENY regardless of all other inputs.
7. Property in a state with a stricter 09:00 start → 08:30 local yields DEFER.
8. Fuzz test: 10,000 random inputs never produce ALLOW when a global suppression exists.

---

## 7. Feature specifications

Each feature is one or more tickets. The format is fixed so tickets stay comparable and reviewable.

---

### F-01 · Consent-First Lead Intake
**Tickets:** `MLH-101` (schema), `MLH-102` (API), `MLH-103` (forms) · **Depends on:** none · **PARALLEL-SAFE with F-02**

**Purpose.** Capture a consented inquiry and create an immutable legal record of exactly what the borrower agreed to.

**Data owned.** `Lead`, `Person`, `ConsentRecord`, `DisclosureVersion`, first `LeadEvent`, first `Task`.

**API.**
```
POST /api/intake
Body (zod-validated, reject unknown keys):
{
  intent: 'REFINANCE' | 'HOME_EQUITY' | 'CASH_OUT',
  firstName, lastName, phone, email,
  property: { addressLine1?, city?, stateCode, postalCode, occupancy, estimatedValue?, currentBalance? },
  goal: 'LOWER_PAYMENT'|'CASH_OUT'|'SHORTEN_TERM'|'DEBT_CONSOLIDATION'|'OTHER',
  timeline: 'ASAP'|'1_3_MONTHS'|'3_6_MONTHS'|'EXPLORING',
  bestContactTime: 'MORNING'|'AFTERNOON'|'EVENING'|'ANY',
  creditRange: 'EXCELLENT_740_PLUS'|'GOOD_680_739'|'FAIR_620_679'|'BELOW_620'|'UNSURE',
  consents: { voice: bool, sms: bool, email: bool, recording: bool },
  disclosureVersionIds: { voice: string, sms: string, ... },
  formFingerprint: string,   // hash of rendered disclosure text, client-computed
  captchaToken: string
}
→ 201 { publicRef, slaDueAt }
→ 422 { fieldErrors }
→ 429 rate limited
```

**Logic.**
```
1. Verify captcha (Turnstile). Fail → 400, log, no lead created.
2. Rate limit: 5/hour per IP, 3/day per phone hash. Exceed → 429 + SECURITY event.
3. Normalise phone → E.164. Invalid → 422 (do NOT create a lead with an unreachable phone).
4. Server-side re-render of the disclosure text for each disclosureVersionId.
   Hash it. If hash ≠ formFingerprint → 422 CONSENT_TEXT_MISMATCH.
   ⚠ This prevents a tampered client claiming consent to text the borrower never saw.
5. BEGIN TRANSACTION
   a. Upsert Person by blind-index(phone). If existing Person is globally suppressed:
      create the Lead in state SUPPRESSED, log SUPPRESSED_ON_INTAKE, skip all outreach,
      return 201 with a neutral message. Never silently re-engage a suppressed person.
   b. Insert ConsentRecord per scope (granted true AND false — record refusals too).
   c. Insert Lead (state NEW), resolve timezone from stateCode → IANA.
   d. Insert LeadEvent LEAD_CREATED with full submitted payload.
   e. Compute slaDueAt = now + config.firstContactSlaMinutes (default 5).
   f. Insert Task FIRST_CONTACT due slaDueAt.
   COMMIT
6. AFTER COMMIT: enqueue outreach.attempt with startAfter = slaDueAt, singletonKey = leadId.
```

**Edge cases.** Duplicate submission within 10 min from same phone → return existing `publicRef`, log `DUPLICATE_INTAKE`, do not create a second lead or second outreach job. Consent to voice but not SMS → lead proceeds, SMS permanently blocked by Rule 4. All consents false → lead created in `NURTURE` with a manual-review task, zero automation.

**Required UI copy (must appear above the submit button, verbatim, version-controlled):**
> This is an inquiry, not a loan application. Submitting this form does not affect your credit score and is not an approval or offer of credit. A licensed loan officer will follow up to discuss your options.

**Acceptance tests.** (a) Valid submission creates exactly 1 lead, N consent rows, 1 event, 1 task, 1 queued job. (b) Tampered `formFingerprint` → 422, zero rows written. (c) Suppressed phone → lead created `SUPPRESSED`, zero jobs queued. (d) Attempt to UPDATE a ConsentRecord → DB error.

---

### F-02 · Suppression & Opt-Out Engine
**Tickets:** `MLH-104` (schema+service), `MLH-105` (webhook), `MLH-106` (admin UI) · **Depends on:** none · **Build before any outbound capability exists.**

**Purpose.** Guarantee that "stop contacting me" is honoured instantly, globally, and permanently.

**API.**
```
POST /api/webhooks/twilio/inbound     (signature-verified)
POST /api/suppression                 (ADMIN/COMPLIANCE only)
GET  /api/suppression?phone=          (COMPLIANCE, audited read)
```

**Logic.**
```
Inbound SMS handler:
1. Verify X-Twilio-Signature. Invalid → 403 + SECURITY event. NEVER process unverified.
2. Normalise body: uppercase, strip punctuation/whitespace.
3. If body ∈ {STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT, REVOKE, OPTOUT}:
     TRANSACTION:
       - upsert Suppression(phone, OPT_OUT_STOP, GLOBAL, expiresAt=null)
       - for every non-terminal Lead with this phone:
           append LeadEvent OPT_OUT_RECEIVED
           transition → SUPPRESSED
           cancel all pg-boss jobs where singletonKey = leadId
           cancel all open Tasks
       - append AuditLog
     Reply with the single provider-level confirmation only. Send nothing else, ever.
4. If body ∈ {START, UNSTOP, YES}: do NOT auto-resubscribe. Create a COMPLIANCE task
   for manual review. Re-consent requires a fresh ConsentRecord through a real form.
5. If body ∈ {HELP, INFO}: send the static help template. Not a re-engagement.
6. Otherwise: append INBOUND_MESSAGE event, route to conversation or officer.
```

**Edge cases.** "stop." / "Please STOP" / "stop texting me" → all treated as opt-out; **be over-inclusive, never under-inclusive.** A STOP arriving while an outreach job holds the lead lock → the job's in-transaction re-check catches it and converts to `BLOCKED`. Opt-out on lead A suppresses leads B and C for the same phone.

**Acceptance tests.** (a) `"stop!"` → suppression row, all jobs cancelled, all leads SUPPRESSED. (b) Unsigned webhook → 403, no writes. (c) `START` after `STOP` → no suppression removal, task created. (d) Race: enqueue send + deliver STOP concurrently 1000× → zero sends after suppression commit.

---

### F-03 · Outreach Orchestrator
**Tickets:** `MLH-107` (worker+queue), `MLH-108` (voice adapter), `MLH-109` (SMS adapter), `MLH-110` (webhooks) · **Depends on:** F-01, F-02, PolicyGate

**Purpose.** Attempt permitted contact within SLA, with retries, fallback, and total traceability.

**Job:** `outreach.attempt { leadId, cadenceStepId, attemptNumber }`, `singletonKey: leadId` (prevents concurrent attempts on one lead), `retryLimit: 3`, `retryBackoff: exponential`, `expireInMinutes: 60`.

**Logic.**
```
TRANSACTION:
  lead = SELECT * FROM Lead WHERE id=? FOR UPDATE          // Rule B
  gateInput = assemble(lead, freshly-read suppressions + consents)  // never cached
  decision = PolicyGate.evaluate(gateInput)
  persist PolicyDecision(decision)

  switch decision:
    DENY:
      append LeadEvent OUTREACH_BLOCKED { reasons }
      if reason is terminal (suppression/consent) → cancel cadence entirely
      else → mark step exhausted
      COMMIT; return
    DEFER:
      append LeadEvent OUTREACH_DEFERRED { reasons, nextPermittedAt }
      reschedule same job at nextPermittedAt (cap: 10 deferrals, then human task)
      COMMIT; return
    ALLOW:
      idempotencyKey = sha256(leadId|stepId|attemptNumber)
      insert ContactAttempt(QUEUED, idempotencyKey, decision.decisionId)
      COMMIT

// OUTSIDE the transaction — never hold a DB lock across a network call
result = adapter.send({ ...payload, idempotencyKey, decisionId })
update ContactAttempt(outcome, providerMessageId)
append LeadEvent OUTREACH_ATTEMPTED
transition lead → ATTEMPTING_CONTACT
```

**Channel fallback (voice → SMS).** Only when: (i) voice outcome ∈ {NO_ANSWER, BUSY, VOICEMAIL}, **and** (ii) the cadence step declares fallback, **and** (iii) a *fresh, separate* `PolicyGate.evaluate(channel=SMS)` returns ALLOW. Voice consent does **not** imply SMS consent — this must be a distinct `ConsentScope` check. Write this as an explicit test.

**Provider failure handling.** 5xx/timeout → pg-boss retry, same `idempotencyKey`, so a duplicate never reaches the borrower. 4xx (invalid number) → no retry, mark `FAILED`, create human task. Provider outage > 15 min → alert, jobs queue naturally, do **not** drop.

**Acceptance tests.** (a) SLA breach: lead not contacted within `slaDueAt + 5min` raises an alert. (b) Voice consent only → after NO_ANSWER, SMS fallback DENIED. (c) Same job replayed 5× → exactly one provider call. (d) 21:05 local → DEFER, sent next morning 08:00.

---

### F-04 · Cadence Engine
**Ticket:** `MLH-111` · **Depends on:** F-03

**Purpose.** Data-driven follow-up sequences, editable without deploying code.

**Logic.** `resolveCadence(lead)` picks the most specific matching `CadencePlan` by scoring: `sourceId` match = 4pts, `stateCode` = 2pts, `intent` = 1pt; highest score wins; ties → lowest `id`; no match → `DEFAULT` plan. Default plan: Day 0 voice (immediate) → Day 0 +2h SMS (if permitted) → Day 1 voice → Day 3 voice + SMS → Day 7 email → `CADENCE_EXHAUSTED`.

**Stop conditions (any → cancel remaining steps):** borrower replies meaningfully, opt-out, officer assignment, lead reaches `QUALIFYING`+, manual pause, complaint.

**Edge case.** Admin edits a cadence mid-flight → in-flight leads keep their *snapshotted* plan version (`Lead.cadencePlanVersionId`). Changing a live plan must never retroactively re-contact people. Test this explicitly.

---

### F-05 · Conversational Qualification Agent
**Tickets:** `MLH-112` (prompt registry), `MLH-113` (session service), `MLH-114` (voice-agent adapter), `MLH-115` (escalation) · **Depends on:** F-03

**Purpose.** Collect facts conversationally, in a compliant order, with a guaranteed human exit.

**Prompt registry.** Prompts live in `packages/core/prompts/*.md`, versioned, hashed, referenced by `PromptVersion.id`. Every `ConversationSession` records the exact prompt version used. **No prompt strings inline in code.**

**Question order (fixed — this ordering is a compliance requirement, not a UX preference):**
```
1. Identify business + purpose + recording notice (if consented) + "you can ask for a human anytime"
2. Confirm right party. Wrong party → immediate WRONG_PARTY suppression, end call.
3. Reason for inquiry (open-ended, borrower's own words)
4. Property basics: address confirm, occupancy (asked truthfully, never suggested)
5. Intent branch:
   REFINANCE → current rate/payment (if known), remaining term, goal
   EQUITY/CASH_OUT → desired amount, use of funds, estimated value, current balance
6. Timeline + urgency
7. Income category (bands only — never exact figures)
8. Self-reported credit range (bands only — never a number, never a pull)
9. LAST, and skippable: hardship indicators (bankruptcy, foreclosure, late payments)
   — prefaced with "you can skip this and it won't affect your next steps"
   — skipping NEVER blocks handoff
10. Confirm best callback time, summarise, set expectation for officer contact
```

**Hard prohibitions in the system prompt (enumerate all, verbatim):** never quote a rate, payment, or approval odds; never say "you qualify" / "you're approved" / "you'll likely get"; never suggest an occupancy answer or hint at a "better" one; never accept an SSN, DOB, account number, or document — if offered, interrupt, refuse, and escalate; never claim to be human if asked directly; never give legal, tax, or financial advice.

**Escalation triggers (any → end automation, create urgent officer task, `LeadEvent ESCALATED`):**
`BORROWER_REQUESTED_HUMAN` · `DISTRESS_DETECTED` (foreclosure, imminent loss, medical/financial crisis language) · `ADVICE_REQUESTED` beyond scope · `SSN_OR_DOC_OFFERED` · `COMPLAINT_LANGUAGE` · `ATTORNEY_MENTIONED` · `CONFUSION_LOOP` (≥2 non-comprehension turns) · `AGENT_UNCERTAIN` (model emits `escalate: true`).

**Implementation note.** Escalation detection runs as a **deterministic keyword/regex pre-filter** *plus* the model's own signal. Do not rely on the model alone to notice distress — a regex for "foreclosure", "attorney", "sue", "harassment" is cheaper, faster, and more reliable, and it catches the cases where the model is confidently wrong.

**Acceptance tests.** (a) Borrower says "can I talk to a person" at turn 2 → escalation within one turn, zero further agent questions. (b) Borrower offers an SSN → agent refuses, no SSN in transcript or logs (assert with a regex scan over stored transcript). (c) Borrower skips hardship → session completes, handoff not blocked. (d) Borrower asks "what rate can I get" → no number in the response (assert). (e) Red-team suite of 30 adversarial transcripts, all passing.

---

### F-06 · Structured Extraction & Field Promotion
**Ticket:** `MLH-116` · **Depends on:** F-05

**Purpose.** Turn conversation into typed, provenanced data without ever letting the model be the system of record.

**Logic.**
```
1. On CONVERSATION_COMPLETED, enqueue extraction.run.
2. Call Claude with a strict tool-use schema (one tool, required fields, enum-constrained).
   Every field's schema includes an explicit `"UNKNOWN"` member. The prompt states:
   "If the borrower did not clearly state this, return UNKNOWN. Never infer. Never guess."
3. Model returns, per field: value, confidence (0-1), transcriptTurnRefs[].
4. Insert one FieldCandidate per field. Nothing touches LeadField yet.
5. Promotion rules (deterministic, in core/extraction/promote.ts):
   - confidence ≥ 0.85 AND turnRefs non-empty AND no existing CONFIRMED value
       → LeadField(status=CONFIRMED)
   - confidence 0.60–0.85 → LeadField(status=CANDIDATE), flagged for officer confirmation
   - confidence < 0.60 → stays a candidate only; LeadField remains UNKNOWN
   - conflicts with an existing FORM value → LeadField(status=CONFLICTED),
       BOTH values shown to the officer, officer resolves. Never auto-overwrite form data.
   - value = UNKNOWN → write LeadField(status=UNKNOWN) explicitly (a row, not an absence)
   - source precedence: OFFICER_ENTERED > FORM > BORROWER_STATED > PROVIDER
6. Append LeadEvent FIELDS_EXTRACTED with the candidate diff.
```

**Non-negotiable.** A field with no `transcriptTurnRefs` is never promoted, whatever the confidence. If the model can't point at where it heard it, it made it up.

**Acceptance tests.** (a) Transcript with no income mention → income field is `UNKNOWN`, never inferred. (b) Model returns high confidence with empty turnRefs → not promoted. (c) Form says PRIMARY, conversation says INVESTMENT → `CONFLICTED`, both visible, no auto-pick. (d) Extraction run twice → idempotent, no duplicate LeadFields.

---

### F-07 · 1003-Aligned Lead Package
**Ticket:** `MLH-117` · **Depends on:** F-06

**Purpose.** Present a structured pre-application profile mapped to 1003 sections, honest about what's missing.

**Mapping** (`core/package/mapping1003.ts`) — sections 1a Borrower Info, 1b Employment (MVP: presence/absence only), 2a Assets (out of MVP), 3 Property & Loan, 4 Loan & Property Info, 5 Declarations (hardship indicators only). Each mapped field carries `{ value, status, source, collectedAt, confidence, transcriptRef }`.

**Completeness score.** Weighted, not a raw percentage: contactable (20) + intent (15) + property identified (15) + occupancy stated (10) + loan purpose (10) + timeline (10) + credit band (10) + income band (10). `UNKNOWN` and `CONFLICTED` both score 0. Score is displayed with the missing-field list — **never as a quality or approval signal.**

**Mandatory UI banner on the package view:**
> Pre-application summary. This is not a completed Form 1003, not an application, and not an approval. Two-year residence and employment history has not been collected and must be gathered by the loan officer.

**Missing-history flag.** Always render `residenceHistory: NOT_COLLECTED` and `employmentHistory: NOT_COLLECTED` explicitly. Silence is the dangerous failure mode here.

**Acceptance tests.** (a) Package always renders `NOT_COLLECTED` for two-year history. (b) No field labelled "verified" unless `verificationStatus = VERIFIED`. (c) Export payload contains no key matching `/ssn|social|dob|birth|credit_score/i` — assert with a schema allowlist, not a denylist.

---

### F-08 · Officer Routing & Assignment
**Ticket:** `MLH-118` · **Depends on:** F-07

**Eligibility filter (all must pass):** officer `isActive`, `propertyStateCode ∈ licensedStates`, `lead.intent ∈ productTypes`, `currentLoad < dailyCapacity`, now within `activeHours`.

**Selection:** among eligible, lowest `currentLoad`; tie → longest since last assignment; tie → lowest id (deterministic, so tests are stable). **No eligible officer** → state stays `READY_FOR_HANDOFF`, create ADMIN task `NO_ELIGIBLE_OFFICER`, alert. **Never assign to an unlicensed officer to clear the queue** — an unassigned lead is a business problem, a misrouted one is a licensing problem.

**Acknowledgement.** Assignment creates an `ACKNOWLEDGE_HANDOFF` task, due +2h. Unacknowledged at due → escalate to admin, optionally reassign (config flag, default off). Acknowledgement transitions to `ACKNOWLEDGED` and **halts all automation permanently** for that lead.

**Manual override.** ADMIN/COMPLIANCE can reassign with a mandatory reason string → `LeadEvent MANUAL_REASSIGNMENT` + `AuditLog`.

---

### F-09 · Officer Workspace (CRM)
**Tickets:** `MLH-119` (list/filters), `MLH-120` (detail+timeline), `MLH-121` (actions) · **Depends on:** F-08

**Views.** Lead list (filter: state, intent, assignee, SLA breach, completeness, state code; default = my leads, newest first). Lead detail with tabs: **Overview** (contact, intent, completeness, missing fields) · **Timeline** (every `LeadEvent`, newest first, with actor/channel/reason — including blocked and deferred attempts, which builds officer trust in the system) · **Package** (1003 view) · **Conversation** (transcript + summary + prompt version) · **Consent** (every ConsentRecord with exact text snapshot) · **Tasks** · **Notes**.

**Actions.** Take over · Call now (manual, still gated by PolicyGate — the gate applies to humans too) · Add note · Confirm/correct a `CANDIDATE` or `CONFLICTED` field (writes `OFFICER_ENTERED`, highest precedence) · Mark won/lost · Request compliance review.

**Access rules.** Officers see only assigned + unassigned-in-their-states leads. `READ_ONLY` sees no PII (masked phone/email). Every detail view writes an `AuditLog` row. COMPLIANCE sees everything, read-only, plus suppression tools.

---

### F-10 · Auth, RBAC & Audit
**Ticket:** `MLH-122` · **Depends on:** none · **Build in Phase 1 alongside F-01/F-02**

Individual accounts only (unique email, no shared logins — the demo's shared login must be deleted, not disabled). TOTP mandatory for ADMIN and COMPLIANCE. DB sessions, 8h idle expiry, admin-revocable. Password: argon2id, 12+ chars, breach-list check.

**Permission matrix** — implement as a single `can(user, action, resource)` function in `core`, used by both API routes and UI rendering. Never check roles inline in a component.

| Action | ADMIN | COMPLIANCE | OFFICER | READ_ONLY |
|---|---|---|---|---|
| View lead PII | ✅ | ✅ | own/in-state | masked |
| Export lead | ✅ | ✅ | own only | ❌ |
| Edit fields | ✅ | ❌ | own only | ❌ |
| Manage suppression | ✅ | ✅ | ❌ | ❌ |
| Edit cadence/prompts/disclosures | ✅ | approve only | ❌ | ❌ |
| Kill switch | ✅ | ✅ | ❌ | ❌ |
| View audit log | ✅ | ✅ | ❌ | ❌ |

Audit every: login (success + failure), PII view, export, role change, suppression change, prompt/disclosure change, kill-switch toggle.

---

### F-11 · LOS/CRM Export
**Ticket:** `MLH-123` · **Depends on:** F-07, F-10

Explicit **allowlist** of exportable field paths in config — anything not on the list is stripped, and adding a path requires a code change plus compliance sign-off. Payload hashed and stored in `ExportRecord`. Retry with the same idempotency key. Export requires the lead to be `ACKNOWLEDGED` unless ADMIN overrides with a reason. Adapter interface: `LosAdapter.export(payload) → { externalId }`. Ship a `NoopLosAdapter` that writes to `ExportRecord` only, so Phase 3 is not blocked on Aldrich choosing a vendor.

---

### F-12 · Admin & Configuration
**Ticket:** `MLH-124`

Officer CRUD (NMLS, states, products, capacity, hours) · Cadence plan editor with versioning · Disclosure version manager (create/approve/retire; approval requires a COMPLIANCE user) · Prompt version manager (same) · Global kill switch (one click, halts all outbound, logged, with a mandatory reason) · Config: SLA minutes, attempt caps, quiet-hour windows per state, spacing.

---

### F-13 · Dashboards
**Ticket:** `MLH-125`

Metrics, all computed from `LeadEvent` (never from ad-hoc counters that drift): leads by state · median time-to-first-contact vs SLA · contact rate by channel · **block/defer rate with reason breakdown** (the compliance health signal — a spike here means something is misconfigured) · conversation completion rate · escalation rate by trigger · median completeness score · handoff acknowledgement latency · opt-out rate.

---

### F-14 · Observability & Ops
**Ticket:** `MLH-126`

Structured JSON logs with `correlationId` propagated from intake through every job and webhook. **Log redaction middleware is mandatory** — a regex scrubber over every log payload for phone, email, SSN patterns; add a CI test that asserts a log line containing a phone number is scrubbed. Alerts: SLA breach, provider error rate > 5%, queue depth > 100, dead-letter non-empty, any suppression-check failure (page immediately), kill-switch activation. Health endpoint checks DB + queue + each adapter.

---

### F-15 · Demo Environment Hardening
**Ticket:** `MLH-100` · **Do this first, before any other ticket.**

Persistent "DEMO — synthetic data only, not a live service" banner on every surface including public forms. Purge any non-synthetic record from Netlify Blobs. Disable all real send paths at the adapter level (not just by config flag — throw at construction if `NODE_ENV === 'demo'`). `robots.txt` disallow + `noindex`. Basic-auth the demo. This ticket exists because a "demo" that can collect a real phone number is a live service with no compliance controls.

---

### F-16 · Data Retention & Subject Rights
**Ticket:** `MLH-127`

Retention config per data class (transcripts, recordings, PII, events, consent). Deletion request workflow: verify identity → soft-delete PII → **retain the consent record and suppression entry forever** (they are the proof of a legal obligation, and deleting a suppression re-exposes you). Export-my-data produces a JSON bundle. Nightly job purges data past retention, logging counts.

---

## 8. Build order

```
Sprint 0 (1–2 days)   MLH-100 demo hardening · repo/CI/env scaffolding
Sprint 1 (Phase 1)    MLH-122 auth/RBAC/audit
                      MLH-101 schema + immutability triggers
                      MLH-POLICY PolicyGate + full unit suite   ← highest-risk, build early
                      MLH-104/105 suppression + webhook
                      MLH-102/103 intake API + forms
                      MLH-119/120 officer list + detail + timeline
Sprint 2 (Phase 2)    MLH-107 worker + queue
                      MLH-108/109 voice + SMS adapters
                      MLH-110 status webhooks
                      MLH-111 cadence engine
                      MLH-121 officer actions · MLH-126 observability
Sprint 3 (Phase 3)    MLH-112/113 prompt registry + session service
                      MLH-114/115 voice-agent adapter + escalation
                      MLH-116 extraction + promotion
                      MLH-117 1003 package · MLH-118 routing
                      MLH-123 export · MLH-124 admin · MLH-125 dashboards
                      MLH-127 retention · red-team pass
```

**Note the ordering choice:** PolicyGate and suppression are built *before* any outbound capability exists. It is impossible to accidentally ship a system that can contact someone before it can be told to stop.

---

## 9. Definition of done (per ticket)

1. Types check, lint passes, no `any`, no `@ts-ignore`.
2. Unit tests for all `core` logic, no mocks required (pure functions).
3. Integration test for every API route including the auth-denied path.
4. Every state change appends a `LeadEvent`; every PII read appends an `AuditLog`.
5. No vendor SDK imported outside `packages/adapters` (CI grep test).
6. No secret in source; `env.ts` validates at boot.
7. Migration is reversible and reviewed.
8. Spec section updated if behaviour changed.

## 10. Go-live gate (blocking, all required)

Attorney-approved consent language, privacy notice, recording notice live · TCPA/DNC/quiet hours configured per launch state and tested · Vendor DPAs signed · Licensed entity + officer NMLS verified per state · Encryption keys in secret manager with rotation tested · Red-team transcripts reviewed and signed off by compliance · Kill switch tested in production · Incident and complaint owner named with contact route · Backup + restore rehearsed · Retention job verified.

---

## 11. Explicitly out of MVP scope

Real-time pricing or rate quotes · credit pulls of any kind (soft or hard) · full 1003 submission · e-sign · document upload · automated underwriting or AUS · marketplace/bidding · payment collection · multilingual · multi-tenant hierarchy · mobile apps.

Any request to add these requires a written change request, a re-baselined date, and a revised commercial figure. This section exists so that "can we just add..." has a documented answer.
