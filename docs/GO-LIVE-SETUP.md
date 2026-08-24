# Go-live setup — Telnyx and Vapi

Everything below is entered in the app at **Admin → Integrations**. Nothing
here requires a redeploy or an edit to `.env`: credentials resolve per request
from the database, so a key saved in the panel takes effect on the next action.

Check **Admin → Go live** at any point. It names the exact missing value for
every capability, and turns green when a new lead would be contacted
automatically, for real.

---

## Step 0 — public URL: already done

Production is live at **https://www.equityflowgroup.com**, serving this
codebase from its own database. Verified:

```
/api/health              200  {"ok":true,"leadCount":30}
/workspace/calls         307  (auth redirect — route exists)
/workspace/messages      307  (auth redirect — route exists)
/api/webhooks/inbound/telnyx  401 (exists, rejects unauthenticated callers)
```

So `APP_URL` is `https://www.equityflowgroup.com` and no tunnel is needed.
Use these exact URLs in the provider portals:

| Purpose | URL |
| --- | --- |
| Telnyx primary messaging webhook | `https://www.equityflowgroup.com/api/webhooks/telnyx` |
| Telnyx failover messaging webhook | `https://www.equityflowgroup.com/api/webhooks/telnyx/failover` |
| Cadence scheduler | `https://www.equityflowgroup.com/api/cron/cadence` |

Vapi needs no URL configured — the app attaches its own callback per call.

### One confirmed gap

`CRON_SECRET` is **not set in production**. The endpoint says so directly:

```
GET /api/cron/cadence → {"ok":false,"error":"CRON_SECRET is not configured"}
```

It fails closed by design, so **no automatic outreach can run at all** right
now, whatever else is configured. Fix this before testing anything automated.

**Where you set it matters.** Credentials resolve database-first, so
Admin → Integrations works for everything the app reads itself. But *Vercel
Cron* sends `Authorization: Bearer $CRON_SECRET` from the **Vercel environment
variable** — it cannot read the database. So:

- Using the GitHub Actions workflow → Admin → Integrations is enough.
- Using Vercel Cron → it must also be a Vercel environment variable, and that
  needs a redeploy to take effect.

Set it in both places if unsure; they are read independently.

## Step 1 — platform secrets

**Admin → Integrations → Platform.** Generate your own values; treat them like
passwords.

```bash
openssl rand -hex 24    # run three times
```

| Field | Value |
| --- | --- |
| Public app URL | `https://www.equityflowgroup.com` |
| Delivery webhook secret | first generated value |
| Cron secret | second generated value |

Telnyx TeXML announcement fetches use a generated, short-lived token unique to each call. Messaging callbacks use Telnyx Ed25519 signatures, and Twilio callbacks use `X-Twilio-Signature`; never put reusable secrets in provider callback URLs.

---

## Part A — Telnyx (SMS first)

SMS is the fastest thing to get working and needs only two fields.

### A1. Buy a number
Portal → **Numbers → Search & Buy**. Pick one with **both SMS and Voice**
enabled. Copy it in E.164 form: `+15125550142`.

### A2. Create an API key
Portal → **Auth → API Keys → Create**. Copy it once — it is not shown again.

### A3. Save in the app
**Admin → Integrations → Telnyx**: paste the API key and phone number, save.
Click **Test connection**.

SMS is now live. Everything below is for calls and replies.

### A4. Inbound replies and STOP
Portal → **Messaging → your Messaging Profile → Inbound Settings**.
Set the signed primary webhook URL to:

```
https://www.equityflowgroup.com/api/webhooks/telnyx
```

Without this, a borrower's STOP reaches the carrier but never reaches us — the
carrier blocks its own channel while the cadence keeps calling and emailing.
That is the TCPA exposure ADR-0007 exists to close.

### A5. Delivery receipts
Set the profile **failover** webhook to:

```
https://www.equityflowgroup.com/api/webhooks/telnyx/failover
```

Without it every text stays "sent" forever, and a number that silently rejects
all traffic looks identical to one that works.

### A6. Calls through Telnyx (optional — skip if using Vapi)
Telnyx fetches call audio from a URL rather than accepting it inline, so calls
need two more identifiers than SMS:

1. Portal → **Voice → TeXML Applications → Create**. Assign your number to it.
2. Copy the **TeXML Application ID**, and your **Account ID** from Account
   Settings.
3. Paste both into the Telnyx card (the two "voice only" fields).

This gives one-way announcement calls. The **automated cadence deliberately
will not place these** — a recorded robocall cannot qualify anyone and repeated
ones are what TCPA complaints are made of. For automatic calling you need Vapi.

---

## Part B — Vapi (the AI agent that actually calls)

You do **not** need to build an assistant in the Vapi dashboard. The app sends
a transient assistant inline with every call — system prompt, first message,
voice, transcriber, and its own callback URL. Anything you configure in the
dashboard would be ignored. Skip straight to the number.

The order below matters: the Vapi connection only appears in Telnyx's outbound
profile picker *after* the number import, so doing B5 early means finding an
empty dropdown.

### B1 · TELNYX — create a dedicated API v2 key
Portal → **Auth → API Keys → Create API Key**. Label it `vapi`. Copy it now.

Keep this one separate from the key the CRM uses. If you ever rotate one, you
want to know exactly what breaks.

### B2 · TELNYX — confirm the number is voice-capable
Portal → **Numbers → My Numbers** → your number. It must show **Voice**
enabled, not SMS alone. A messaging-only number imports into Vapi and then
fails on the first call with no obvious cause.

### B3 · VAPI — get the private API key
dashboard.vapi.ai → **Organization → API Keys**. Copy the **private** key.

The public key is for browser widgets and will fail server-side with:
*"Invalid Key. Hot tip, you may be using the private key instead of the public
key, or vice versa."* This exact error is already in the call log from an
earlier attempt.

### B4 · VAPI — import the Telnyx number
**Phone Numbers → Import → Telnyx.** Supply:

- **Phone number** — E.164, e.g. `+15125550142`
- **API key** — the Telnyx key from B1
- **Label** — optional

Inbound now works. Outbound does not yet.

### B5 · TELNYX — enable outbound (this is the step that blocked you)
Portal → **Voice → Outbound Voice Profiles** → create or open a profile.

1. Under **Connections and Applications**, add **Vapi** as a connection.
   It appears in this list only because B4 has been done.
2. Enable the **destinations** you will call — United States at minimum.
3. Save.

Without this, Vapi accepts the call request and the call silently never
places. This is why the trial appeared to be "inbound only".

### B6 · VAPI — copy the phone number ID
Open the imported number; the ID is the UUID in the page URL. Or:

```bash
curl -H "Authorization: Bearer <VAPI_PRIVATE_KEY>" https://api.vapi.ai/phone-number
```

Take the `id` field — a UUID, not the phone number itself.

### B7 · APP — save the three values
**Admin → Integrations → Vapi** at
`https://www.equityflowgroup.com/workspace/admin`:

| Field | Value |
| --- | --- |
| API key | Vapi **private** key (B3) |
| Phone number ID | UUID from B6 |
| Webhook secret | a value you generate — `openssl rand -hex 24` |

Save. **Admin → Go live** should now show *AI voice agent — Live*.

No webhook URL to configure anywhere: the app attaches its own callback and
the shared secret to every call, and verifies that secret on every event.

### B8 · Test
Open any lead → **Call**. Your phone rings, the agent speaks. Open
**Call Centre** — the call appears under *In progress* with the transcript
filling in as you talk.

If it fails, the Call Centre shows the provider's own words under
*"calls the provider refused"*. Read that message before changing anything:

| Message contains | Cause |
| --- | --- |
| `Invalid Key` | public key used instead of private — B3 |
| call places then drops instantly | outbound profile — B5 |
| `phoneNumberId` invalid | you saved the phone number, not its UUID — B6 |

## Part C — the scheduler

Nothing is sent at intake time. The cadence engine only runs when something
calls it, and the first step is offset 0 minutes against a 5-minute SLA.
**Vercel Hobby permits daily crons only**, which means a lead submitted at
09:00 waits ~23 hours.

Use the workflow already in the repo at
`.github/workflows/cadence-scheduler.yml` (every 5 minutes, free). Add two
repository secrets: `APP_URL` and `CRON_SECRET`. Merge it to your default
branch — GitHub only schedules workflows that exist there.

**Run exactly one scheduler.** If this workflow is active, leave `vercel.json`
on its daily schedule or remove its cron block; two overlapping ticks can send
the same step twice.

Fire one by hand to confirm:

```bash
curl -H "Authorization: Bearer <CRON_SECRET>" https://www.equityflowgroup.com/api/cron/cadence
```

Expect a JSON summary with counts. A 401 means the secret does not match.

---

## Part D — test sequence

Use **your own mobile number** throughout. Do not test on a stranger.

1. **SMS, manually.** Open any lead → **Text** → send. Your phone should
   receive it. Check **Message centre** — the send appears immediately.
2. **Delivery receipt.** Within a few seconds the attempt should advance from
   SENT to DELIVERED. If it stays SENT, step A5 is wrong.
3. **Inbound.** Reply from your phone. It appears in the lead's Conversation
   tab as a borrower message, and Message centre moves that lead to the top
   with **"Replied — needs an answer"**.
4. **STOP.** Text `STOP`. You get one confirmation, the lead shows **Opted
   out**, and the send box disappears. Verify the suppression is **GLOBAL** —
   calls and email stop too, not just SMS.
5. **AI call.** Lead → **Call**. Your phone rings and the agent speaks. Open
   **Call Centre** — the call appears under *In progress* with the transcript
   filling in as you talk.
6. **Context.** Before the call, send a message in the post-submit chat
   ("I'm away until Friday"). Then trigger the call. The agent should
   acknowledge it and must not re-ask what you already answered.
7. **End to end.** Submit the public intake form with your own details, then
   fire the cron manually. The cadence should place the first call and, later,
   the first text — with no human action.

To undo step 4, remove the suppression in **Admin → Suppression**.

---

## Known blockers, in the order you will hit them

**10DLC registration.** US carriers block unregistered A2P traffic. Telnyx
registration takes **1–3 business days**, and until it clears your texts to US
numbers may be filtered or rejected outright — with the send still reported as
accepted. Start this first; it is the longest lead time in this guide and the
one most likely to derail a demo.

**Telnyx trial restrictions.** A trial account can be limited to verified
destination numbers. Verify your own mobile in the portal before testing.

**Vapi outbound.** If calls fail with the number importing fine, it is almost
always the Outbound Voice Profile in B3.

**Database resets.** Production has its own database and currently holds 30
leads, so persistence is working. If lead counts ever drop to the seed set
after a deploy, `DATABASE_URL` has been lost and the app has fallen back to
ephemeral file storage.

---

## Minimum for fully automatic, real outreach

| Value | Gets you |
| --- | --- |
| `TELNYX_API_KEY`, `TELNYX_PHONE_NUMBER` | real SMS |
| `VAPI_API_KEY`, `VAPI_PHONE_NUMBER_ID`, `VAPI_WEBHOOK_SECRET` | real AI calls |
| `APP_URL` | callbacks can reach you |
| `DELIVERY_WEBHOOK_SECRET` | legacy callback compatibility only; new provider routes use native signatures |
| `CRON_SECRET` + a scheduler | anything automatic at all |

The linked Vercel project is currently on the Hobby plan, which permits only daily cron schedules. Keep `vercel.json` free of sub-daily schedules on that plan and configure an external scheduler to call `/api/cron/process-webhooks` every minute and `/api/cron/cadence` every five minutes with `Authorization: Bearer <CRON_SECRET>`. A Vercel Pro project may register those schedules directly instead.

Add `NVIDIA_API_KEY` (free) so messages are written for the borrower rather
than from a template, and `RESEND_API_KEY` for email.
