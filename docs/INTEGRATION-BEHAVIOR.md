# Integration behaviour — what the CRM does in every state

Each integration exists in one of four states, and the product has to behave
sensibly in all four. This document is the contract: what an operator should
expect to see, what the lead record ends up saying, and who gets told.

The governing principle: **the CRM must never claim more than it knows.** A
provider accepting a message is not delivery. A modelled number is not a
measured one. A simulated send is not a send. Every place those differ, the UI
says so.

---

## The four states

| State | When | Principle |
| --- | --- | --- |
| **Unconfigured** | No credentials for that integration | Simulate visibly. Never block the product; never imply a real send. |
| **Live and healthy** | Credentials valid, provider accepting | Record what the provider actually reported, not what we hoped. |
| **Live but failing — per-lead** | Bad number/address for this borrower | Stop that channel for this lead, flag the contact, tell an officer. |
| **Live but failing — systemic** | Bad credentials, unregistered 10DLC, unverified domain | Every lead is affected. One alert, pause the cadence, tell an admin. |

Failure classification lives in `src/core/deliveryStatus.ts` and is unit-tested
against the actual error codes Twilio, Telnyx, and Resend emit.

---

## Voice — one mechanism, chosen by capability

There is one Call button. What it does depends on what is configured, and it
always says which:

| Configured | Mechanism | What the borrower gets |
| --- | --- | --- |
| Vapi (key + number id + saved assistant id + webhook secret) | **VAPI_AGENT** | A real conversation. Transcribed back onto the lead, feeds extraction. |
| Twilio only | **ANNOUNCEMENT** (degraded) | A recorded message read at them. One-way, no transcript, qualifies nobody. |
| Neither | **SIMULATED** | Nothing is dialled. |

Preference order is fixed in `src/core/callStrategy.ts` and unit-tested: Vapi
wins whenever it is available, even if Twilio is also configured.

This used to be two peer buttons — "Call" (Twilio announcement) and "AI call"
(Vapi) — with the announcement as the default *and* as what every automated
cadence VOICE step placed. That is backwards. A recorded robocall is strictly
worse on every axis, and it was the thing the product led with.

Two consequences of the fix worth knowing:

- **The cadence will not place unattended announcements.** If no conversational
  agent is configured, a VOICE step routes to SMS instead and logs why
  (`voiceDowngraded` in the tick summary). Repeated recorded calls to a
  consumer is the pattern TCPA complaints are built from, and it cannot
  advance the lead anyway.
- **A degraded call is labelled in the dialer**, with the specific remedy — and
  when Vapi is only partly configured, it names the missing fields rather than
  saying "not configured" to someone who just pasted an API key.

### One conversation across channels

The agent receives the borrower's existing SMS/email/call history
(`core/conversationThread.ts` → `buildConversationBrief`) in its system prompt,
and opens with a continuation line rather than a fresh introduction. Before
this, voice was the only channel that started cold: a borrower who had texted
"call me after 5" would get an AI call that re-asked everything.

The same derived thread begins with the intake form and includes portal chat,
inbound and outbound SMS, email, and speaker-attributed Vapi turns. Ordinary
inbound texts are attached to one inquiry (most recent successful outbound SMS
wins), saved before any network call, and enqueue an automatic AI response.
STOP/START/HELP and possible opt-out language never enter the AI reply path.
The protected outbox worker retries replies and records the exact sent copy as
an outbound contact attempt, so Message Centre and the lead view share one truth.

## Outbound messaging (SMS · Email)

### Unconfigured
The adapter logs `[SIMULATED SMS] …` and returns a `sim_*` id. The attempt is
recorded so the pipeline is explorable end to end. The UI says **"queued
(simulated — no provider configured)"**, and the global demo banner flips
between DEMO and LIVE from the same runtime capabilities rather than being
hardcoded — so it stops claiming "no real calls are sent" the moment a key is
entered.

### Live and healthy
1. `PolicyGate` decides whether a new outreach touch is permitted. An immediate
   reply to an inbound borrower SMS uses a narrower transactional gate: kill
   switch, suppression, SMS consent, and terminal state still fail closed, but
   cadence spacing and attempt caps do not delay the borrower-facing answer.
2. The adapter sends and returns `{ ok: true, providerMessageId }`.
3. The attempt is recorded as **SENT** — meaning *the provider accepted it*,
   not that it arrived.
4. Minutes later the provider's delivery callback advances it to **DELIVERED**
   or **UNDELIVERED** (`/api/webhooks/delivery/[provider]`).

Step 4 is the part most CRMs skip. Without it every attempt is frozen at the
moment of handoff and the contact history is optimistic rather than true.
Out-of-order and duplicate callbacks are rejected: a delayed "sent" arriving
after "delivered" cannot walk an attempt backwards, and a settled outcome is
never overwritten by a second terminal one.

> **This requires provider-native webhook authentication.** Twilio validates
> `X-Twilio-Signature` with the account auth token; Telnyx validates Ed25519
> signatures with `TELNYX_PUBLIC_KEY`; Resend validates Svix signatures. Do not
> put a shared secret in a callback URL.

### Live but failing — per-lead (PERMANENT)
Invalid number, landline, disconnected handset, hard-bounced mailbox, or a
carrier reporting the borrower sent STOP.

- Attempt recorded **FAILED** with the provider's own error code.
- **The attempt does not count against the lead's contact caps.** A message the
  carrier refused contacted nobody, and those caps exist to limit contact.
- The contact is flagged `PHONE_UNDELIVERABLE` / `EMAIL_UNDELIVERABLE`, so the
  channel router routes around it instead of rediscovering the problem on every
  step.
- A **REVIEW_CONTACT_DATA** task is raised for the assigned officer.
- No retry. Retrying a number the carrier has already rejected is waste, and in
  the STOP case is a TCPA violation.

### Live but failing — systemic (CONFIGURATION)
Bad API key, unowned "from" number, unregistered or pending 10DLC campaign,
unverified sending domain.

- Attempt recorded **FAILED**, caps untouched, same as above.
- **One** `INTEGRATION_ALERT` task for the whole outage, deduplicated by
  message — not one task per lead.
- The cadence **holds** on affected leads rather than retrying. Per-lead retries
  would multiply a single administrator-level error into thousands of failed
  sends and real provider spend.

### Live but failing — transient (TRANSIENT)
Network blip, 429, provider 5xx, or any unrecognised error.

- Retried with backoff at **5 → 15 → 60 minutes**, then given up on.
- Nobody is alerted unless it exhausts the budget — a blip is not news.
- Unknown error codes deliberately land here rather than in PERMANENT: wrongly
  marking a real borrower's number permanently dead is worse than one wasted
  retry.

---

## The cadence engine

Steps fire in order, one per due offset, each gated by PolicyGate.

**A failed send does not advance the cadence.** Failures emit `OUTREACH_FAILED`
rather than `OUTREACH_ATTEMPTED`, and the step counter only counts the latter.
Without this, a provider outage silently burns a lead's entire cadence and drops
them into NURTURE having never once been contacted.

That retry is bounded — see the retry policy above. Permanent and configuration
failures hold the cadence (`heldForFailure` in the tick summary) rather than
looping forever.

### Scheduling caveat — read before promising response times

`vercel.json` currently runs the cadence **once daily at 08:00**, because
**Vercel's Hobby plan rejects any cron that fires more than once per day** —
a `*/15 * * * *` schedule fails at deploy time with:

> Hobby accounts are limited to daily cron jobs.

So on the current plan the default cadence's 0-minute and 120-minute steps
cannot fire on time, and the "first contact within minutes" SLA is **not**
achievable through Vercel cron. Do not promise it until one of the options
below is in place.

**Three ways to get frequent cadence:**

| Option | Cost | Notes |
| --- | --- | --- |
| Vercel Pro | $20/mo | Change the schedule back to `*/15 * * * *` and redeploy |
| External pinger | Free | Point cron-job.org (or similar) at `POST /api/cron/cadence` with header `Authorization: Bearer $CRON_SECRET`, every 15 min. The endpoint is plan-independent — only Vercel's *built-in* scheduler is capped |
| Leave daily | Free | Fine while the borrower-initiated path is the primary contact route |

The external pinger is the pragmatic choice: the cadence endpoint is just an
authenticated HTTP route, and nothing about it depends on who calls it.

Even at 15 minutes, a 0-minute step lands up to 15 minutes late. The
instant-response path is the borrower-initiated one on the post-submit screen
(Call me / Text me / Email me), which fires synchronously. The cadence is the
safety net for borrowers who close the tab, not the mechanism for the
sub-minute promise.

If sub-minute automated first contact is a real requirement, the fix is to fire
step 0 inline at intake rather than raising cron frequency further.

---

## AI (extraction · outreach copy · borrower chat)

**Unconfigured, or after an API failure:** falls back to keyword matching and
fixed templates. Content is marked `aiGenerated: false` on the attempt so the
distinction survives into the record, not just the UI.

The fallback is a genuine degradation, not an equivalent. Templates do not use
conversation history, do not adapt tone, and do not answer borrower questions —
the chat returns a generic hand-off instead. An LLM key is required for the
product to behave as demonstrated.

Hard compliance rules live in the system prompts and apply to every path: never
quote a rate, payment, or approval odds; never say "you qualify"; never request
SSN or DOB. These are prompt-level, which means they are strong but not
guaranteed — a reviewed-before-send workflow is the control for anything
higher-stakes than qualification chat.

## Property valuation (RentCast)

RentCast is the primary parcel-level valuation source when configured. Public
records, Census context, FHFA time adjustments, and the borrower's estimate are
still collected as an independent corroboration layer.

| Field | Live with RentCast | Simulated |
| --- | --- | --- |
| Estimated value | **Measured** | Modelled from state median |
| Confidence range, comps, last sale | **Measured** (when returned) | Modelled |
| Property type, year built | **Measured** (when returned) | Modelled |
| Mortgage balance, LTV, usable equity | **Modelled** | Modelled |

The balance/LTV/equity trio is modelled on **every** path. No AVM vendor
publishes outstanding mortgage balances — that is private lender data, never
public record — so those three are an assumed-LTV calculation on top of whatever
value we have. They carry an `est` marker in the valuation card, because an
officer quoting a borrower's equity from a modelled number is a real problem.

When both layers return a supported value, the final planning estimate is 75%
RentCast and 25% corroborating evidence. Source disagreement widens the range
and lowers confidence; all evidence remains visible in the CRM. This remains an
informational estimate, never an appraisal.

## Lead discovery (Reddit)

**Unconfigured:** inserts four fictional signals whose links point at subreddit
home pages, with a visible warning on the discovery page. These are illustrative
of the workflow, not leads. Do not act on them.

**Live only after written commercial approval and OAuth:** approved Reddit API results. Note that discovery surfaces *signals*, not
contactable leads — nothing here is auto-contacted, and it must not be. Cold
outreach to someone who posted publicly is a different consent posture than a
borrower who submitted an intake form.

---

## Go-live sequence

1. **`CREDENTIAL_SECRET` and `DATABASE_URL`** — environment only. Nothing else
   works properly without them (see ADR-0002, ADR-0003).
2. **Start 10DLC registration on Telnyx and/or Twilio immediately.** It takes
   1–3 business days and is the binding constraint on launch date. Register on
   both if you intend to keep both (ADR-0004).
3. **Signed provider webhooks** — configure Twilio inbound/delivery routes,
   Telnyx signed primary/failover routes, and the Resend Svix webhook. Skipping
   this leaves the CRM blind to delivery failures and STOP events.
4. **LLM key** (Anthropic, or NVIDIA for the free tier) — without it the AI
   features are templates.
5. **Resend**, including the delivery-events webhook, not just the API key.
6. **Vapi** — needs API key, phone-number id, published assistant id, and
   webhook secret. The assistant must use the authenticated CRM Server URL,
   emit status-update, conversation-update, final transcript, and
   end-of-call-report events, and have transcript/log artifacts enabled.
7. **Verify with an approved test number**, then check the attempt actually
   reaches DELIVERED. If it stays SENT, step 3 is not finished.

---

## Controlled rollout boundaries

- Signed inbound SMS and STOP/START/HELP are implemented; they remain operationally
  unavailable until the carrier signing key and primary/failover URLs are configured.
- Snapshot compatibility writes are awaited and revision-merged. Normalized schemas,
  queues, identity, and operational records are migrated; normalized authoritative
  reads remain locked pending the comparison window.
- Durable webhook and outbox queues provide retry/dead-letter state. A protected
  scheduler must still invoke both workers at the required frequency.
- Production does not seed shared demo credentials.
- Manual announcement calls and Vapi conversational calls are distinct. Vapi warm
  transfer success is based on bridge lifecycle events, not carrier acceptance alone.
