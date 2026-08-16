# Testing guide — five feature areas, step by step

Written for someone with the app running and admin access, no code knowledge
assumed. Each section works **twice**: once with nothing configured (to see the
simulated path and confirm the app is honest about it) and once live.

**Golden rule while testing:** the top banner tells you which mode you're in.
`DEMO — synthetic data only` means nothing leaves the building.
`LIVE — this deployment sends real calls, texts, and/or emails` means it does.
That banner is computed from your actual credentials, not hardcoded, so it is
the single most reliable indicator on screen.

> **Before any live test, put your own phone number and email on a test lead.**
> Every seeded lead has a fake `+1555…` number. Live tests with those will fail
> as invalid — which is itself a useful test, but not the one you meant.

---

## Setup once: where keys go

**Admin → Integrations.** Everything except two values is configured here, and
takes effect on the *next request* — no redeploy, no restart. Each integration
card carries its own numbered setup steps and a **Test connection** button.

The two exceptions live in environment variables because they're needed to read
the credential store itself:

| Variable | Why |
| --- | --- |
| `DATABASE_URL` | The store is a table in this database |
| `CREDENTIAL_SECRET` | Encrypts the store — keeping it beside the ciphertext would protect nothing |

If `CREDENTIAL_SECRET` is missing, the Integrations panel shows a warning banner
and refuses to save rather than storing keys in plaintext.

---

## 1. AI voice agent + AI features

### 1a. Confirm the unconfigured behaviour first

1. Open any lead → **Call**.
2. Expect: **"Nothing dialled"**, "No voice provider is connected", and a remedy
   naming Vapi. Nothing was dialled — this is correct, not a failure.
3. Close. Check the **Timeline** tab: an attempt was still recorded, so you can
   see the pipeline shape.

### 1b. Go live on Vapi

Vapi needs **three** values together. With only the API key, the panel tells you
exactly which two are missing rather than saying "not configured".

1. Create an account at vapi.ai; import or buy a phone number.
2. **Admin → Integrations → Vapi**, enter:
   - `VAPI_API_KEY`
   - `VAPI_PHONE_NUMBER_ID` (the number's ID, not the number itself)
   - `VAPI_WEBHOOK_SECRET` (invent a strong random string; you'll paste the same
     one into Vapi)
3. In Vapi's dashboard set the assistant **Server URL** to
   `https://<your-domain>/api/webhooks/vapi` and the **secret** to the same
   value.
4. Reload. The banner should now read **LIVE**.

### 1c. Place a real AI call

1. Put your own mobile on a test lead (Overview → edit contact).
2. Click **Call**.
3. Expect the dialer to say **"AI agent is on the call"** under a *Live
   conversation* heading — not "one-way announcement".
4. Answer your phone. Have a short conversation: say your timeline, your credit
   band, and what you want to do.
5. Hang up, wait ~30 seconds, then reload the lead.

**What must be true afterwards:**

| Where | Expected |
| --- | --- |
| Timeline | Attempt outcome is **Answered**, with a duration — not stuck on "Queued" |
| Conversation tab | Full turn-by-turn transcript |
| Lead state | Advanced to **In conversation** |
| Package tab | Fields the agent heard, promoted with citations |

If the transcript never arrives, the webhook is the problem — check the Server
URL and that the secret matches exactly on both sides.

### 1d. The cross-channel memory test (the interesting one)

1. Send the lead a text first (**Text** → send something specific, e.g. "I'm
   away until Thursday").
2. *Then* click **Call**.
3. The agent should open with a **continuation** ("following up on our earlier
   messages…"), not a fresh introduction, and should not re-ask what you already
   said by text.

This is the single best demonstration that voice and text share one conversation
rather than being two disconnected channels.

### 1e. Other AI features

Add an **Anthropic** key (or **NVIDIA**, which has a free tier) under
Integrations, then:

- **Text / Email compose** → the AI draft note changes from "Simulated draft" to
  "Drafted by Claude — review before sending."
- **Package tab → Run AI extraction** on a lead with a transcript.
- **Lead detail → AI-drafted outreach** adapts to prior conversation.

Without an LLM key these fall back to keyword matching and fixed templates. That
is a real degradation, not an equivalent — the attempt is marked
`aiGenerated: false` so you can tell them apart later in the record.

---

## 2. Text, email, and delivery tracking

### 2a. SMS

1. **Admin → Integrations → Telnyx** (preferred, cheaper) *or* **Twilio**. Enter
   the API key and the sending phone number.
2. **Start 10DLC registration immediately** — it takes 1–3 business days and is
   the binding constraint on going live. Until it completes, carriers may reject
   your messages with a "campaign not registered" error, which the app will
   surface as a configuration problem, not a per-lead one.
3. Open a lead → **Text** → send.
4. Expect **"Text sent to carrier. Delivery will confirm shortly."** — note the
   wording. It does *not* claim delivery, because at that moment the carrier
   hasn't confirmed anything.

### 2b. Delivery receipts — do not skip this

Without this step every message stays at "Sent" forever and you will never learn
about a bounce or a blocked number.

1. **Admin → Integrations → Platform**, set `DELIVERY_WEBHOOK_SECRET`
   (generate with `openssl rand -hex 32`).
2. In Twilio, set the number's **StatusCallback** to
   `https://<your-domain>/api/webhooks/delivery/twilio`
   (or Telnyx's messaging-profile webhook → `/api/webhooks/delivery/telnyx`).
   The app appends the secret automatically when sending, so you only paste it
   into the panel.
3. Send another text and watch the Timeline: **Sent → Delivered** within a
   minute or two.

**Then test the failure path**, which is the part that matters:

1. Edit a test lead's phone to a landline or an invalid number.
2. Send a text.
3. Expect: attempt marked **Undelivered**, a **Review contact data** task
   raised, the contact flagged undeliverable, and **no retry** (retrying a
   number the carrier rejected is waste, and after a STOP it's a violation).
4. Confirm the lead's daily attempt count did **not** increase — a message
   nobody received didn't contact anyone.

### 2c. Email

1. **Admin → Integrations → Resend.** Enter the API key **and verify your
   sending domain in Resend first.**
2. Set the **From address** field to an address on that verified domain.
   > This matters more than it looks. The default sender is
   > `leads@equityflowgroup.demo`, a placeholder domain no provider will accept.
   > If you leave it, sends fail. The app now prefers your configured verified
   > address and logs a warning if it's still a placeholder.
3. Add the **Delivery webhook secret** (Resend → Webhooks → `email.sent`,
   `email.delivered`, `email.bounced` → `/api/webhooks/delivery/resend`).
4. Send an email from a lead. Check Timeline for Sent → Delivered.

**Email templates in use:** account invite, password reset, and borrower
outreach (AI-generated per lead, with the status-page link appended). Sender
name/address come from **Admin → Settings → Outreach sender identity**; the
deliverable domain comes from Integrations and wins over Settings.

### 2d. Out-of-hours testing (the new override)

PolicyGate blocks contact outside the borrower's **local** hours — so if you're
testing from a timezone where it's the middle of the night in the US, every send
will defer. That's correct behaviour, not a bug.

To test anyway: **Admin → Settings → Manual outreach overrides** → tick
*"Allow contact outside permitted local hours"* → Save.

- Applies **only** to a human clicking Call/Text/Email. Automated cadence steps
  never inherit it.
- Cannot override opt-outs, STOP replies, the suppression/DNC list, missing or
  revoked consent, the kill switch, or closed leads. Those are legal bars.
- Every change is written to the audit log with your name.

**Turn it back off after testing.**

---

## 3. Lead scoring

No API keys needed — this is pure logic and works immediately.

1. Submit an intake at `/apply` designed to score **high**: a licensed state
   (CA/TX/FL/NV/NY/SC), **cash-out** or **debt consolidation**, timeline
   **ASAP**, high home value with a low balance, and complete the form quickly
   (under 2 minutes).
2. Open the lead → **Overview → Lead quality score**.

**Read the breakdown**, which shows all four components:

| Component | Max | Full marks when |
| --- | --- | --- |
| Equity | 40 | LTV ≤ 70% (partial 25 at 70–80%, zero above 80%) |
| Product margin | 25 | Cash-out or debt consolidation (20 home equity, 10 rate-and-term) |
| State licensing | 20 | A licensing-priority state (10 for other supported states) |
| Urgency & behavior | 15 | Urgency **and** a fast completion — one alone gives 8 |

3. Above the **hot-lead threshold** (default 80, editable in Settings) the lead
   is auto-assigned and the officer is paged by SMS. Check **Tasks** for a
   *Hot lead alert*.
4. Now submit a deliberately **cold** one: an unsupported state, rate-and-term,
   exploring timeline, high balance. Expect a low score and no hot alert.

Note the score is separate from **completeness** — scoring predicts deal quality
from intake data; completeness measures how much 1003 data you've collected.

---

## 4. Lead discovery

No credentials are required — discovery reads a public archive rather than
Reddit's API (see ADR 0006), so it is live out of the box.

1. Open `/workspace/discovery` and click **Run discovery**. It takes ~30 s: it
   sweeps recent posts and comments across eight consumer-mortgage subreddits.
2. Expect roughly 40–50 signals, all posted within the last 14 days. Anything
   older is dropped rather than shown.
3. Spot-check a result: the title links to the **original thread** on Reddit.
   Confirm the post is real, recent, and genuinely about a mortgage.
4. Click a signal → **Classify intent** (needs an LLM key) → **Draft reply**.

**If it returns nothing:** that means the archive was unreachable, and the
banner says so explicitly. An empty queue is never silently reported as a
successful run.

**Important:** discovery surfaces *signals*, not contactable leads. Nothing here
is auto-contacted and it must not be. Someone who posted publicly has a very
different consent posture from a borrower who submitted your form.

---

## 5. Property valuation

1. **Without a key:** every figure is modelled from state medians. The card says
   so plainly.
2. **Live:** sign up at rentcast.io (free tier available), enter
   `PROPERTY_DATA_API_KEY` under Integrations.
3. A live lookup needs a **street address** — the app deliberately skips the API
   call without one, to preserve your free-tier quota. Add a real address to a
   test lead.
4. Reload the lead → **Property valuation**.

**Read the `EST` markers carefully.** Even on a live lookup, three figures are
still modelled:

| Field | Live source |
| --- | --- |
| Estimated value, range, comps, last sale, property type, year built | **Measured** — from RentCast |
| Mortgage balance, LTV, usable equity | **Modelled** — marked `EST` |

No AVM vendor publishes outstanding mortgage balances; that's private lender
data, never public record. Those three are an assumed-LTV calculation on top of
the real value. **Do not quote them to a borrower as fact.**

---

## 6. Post-submission chatbot

1. Complete an intake at `/apply` end to end.
2. On the confirmation screen you get the chat handoff with **Call me now**,
   **Text me**, **Email me**, plus a free-text question box.
3. **Test each button.** Each runs through PolicyGate exactly like an officer
   action would, and reports honestly:
   - configured and permitted → real contact, confirmation message
   - outside quiet hours → offers a callback at the next permitted time rather
     than silently doing nothing
   - nothing configured → says "(simulated)"
4. **Test the question box** (needs an LLM key). Ask something answerable
   ("what documents will I need?") and something it must refuse
   ("what rate will I get?").

**The refusal is the important test.** The assistant is instructed never to
quote a rate, payment amount, or approval odds, and never to say "you qualify".
It should decline and offer a licensed officer callback instead. If it ever
quotes a number, stop and report it — that's a compliance issue, not a bug.

5. Check the lead's **Conversation** tab: the chat exchange appears in the same
   unified thread as calls and emails.

---

## Quick troubleshooting

| Symptom | Cause |
| --- | --- |
| Banner still says DEMO after entering keys | Key saved but incomplete — Vapi needs all three fields, Twilio needs SID + token + number |
| Call places a robocall instead of a conversation | Vapi not fully configured; the dialer names the missing fields |
| Message stuck on "Sent", never "Delivered" | `DELIVERY_WEBHOOK_SECRET` not set, or the provider's status callback URL isn't pointed at this app |
| Every email fails | Sending domain not verified in Resend, or From address still on the placeholder domain |
| Everything defers with QUIET_HOURS_LOCAL | It's night in the borrower's timezone. Use the manual override for testing, then turn it off |
| Deploy fails: "Hobby accounts are limited to daily cron jobs" | `vercel.json` had a sub-daily schedule. It now ships as daily (`0 8 * * *`) so Hobby deploys cleanly |
| Cadence steps only run once a day | That's the Hobby cron cap. Either upgrade to Pro and set `*/15 * * * *`, or point a free external pinger (cron-job.org) at `POST /api/cron/cadence` with `Authorization: Bearer $CRON_SECRET` |
| AI call never produces a transcript | Vapi Server URL wrong, or webhook secret mismatch |

## Known gaps — don't test for these, they aren't built

- **Inbound SMS is not captured.** Borrower replies by text won't appear in the
  thread. Email and voice replies do.
- **No job queue.** Cadence is a cron sweep, not a per-item retry queue.
- **Persistence is a single JSON blob** with per-instance caching. Fine at
  current volume; concurrent instances can overwrite each other under load.
- **Seeded demo data and a shared demo password** ship by default. Both must be
  removed before real borrower data goes in.
