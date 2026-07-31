# Deploying to Vercel

The app is Vercel-ready as of the 2026-07-28 build (`npm run build` passes clean). One thing is required before the public link is safe to hand out: a real database — the app now refuses to boot in production without one (see `src/instrumentation.ts`). Everything else (Twilio, Resend, Anthropic/NVIDIA, Reddit, RentCast, Vapi) is optional and simulates until you add its key, same as local dev.

## Authentication

Real email/password login — there is no more "view as" role switcher. Every seeded demo account shares one password:

| Email | Role | Password |
|---|---|---|
| `newanubhav.4@gmail.com` | Admin | `MlhDemo#2026` |
| `dana.whitfield@mortgageleadhub.com` | Compliance | `MlhDemo#2026` |
| `marcus.chen@mortgageleadhub.com` | Officer | `MlhDemo#2026` |
| `investor@mortgageleadhub.com` | Read-only | `MlhDemo#2026` |

**Change these before handing out a real deployment's link** — sign in as Admin → Users, or just have each person use "Forgot your password?" on `/login` to set their own. Real users you create via Admin → Users get emailed an invite link (`/accept-invite`) to set their own password instead of ever seeing this one — see `src/domain/actions.ts` (`createUserAction`) and `src/domain/authActions.ts`.

## Quickest path: just get the text flow in front of Aldrish

This is the shortest path to "submit an inquiry → get a real text message on your phone", using only free-tier signups. Full detail on each step is below.

1. **Twilio free trial** (twilio.com/try-twilio) — no credit card charge, ~$15 in trial credit. Grabs you `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and a free trial phone number (`TWILIO_PHONE_NUMBER`).
   - ⚠️ **Trial accounts can only text phone numbers you've verified in the Twilio console** (Phone Numbers → Verified Caller IDs). Add Aldrish's actual cell number there before he tests, or he won't receive anything and it'll look broken. Trial texts also arrive prefixed with "Sent from your Twilio trial account -".
2. **NVIDIA NIM free API key** (build.nvidia.com) — sign in, open any chat model, click "Get API Key". Free tier, no card. Gets you `NVIDIA_API_KEY` for the AI-drafted text content (see below — optional, the flow works without it too, just with a canned message instead of an AI one).
3. **Vercel Postgres** — free tier, one click, see Step 1 below. Skippable if you only want a single smoke test and don't care whether the lead is still there five minutes later, but takes 30 seconds so there's little reason to skip it.
4. Push to GitHub, import into Vercel, set the env vars below, deploy (Steps 2–3).
5. Test: open `/apply` on the deployed URL, submit an inquiry using **the verified phone number**, consent to text messages, and on the post-submit screen tap **Text me**. A real SMS should arrive within a few seconds.

## Why a database is required (and file storage isn't enough)

Locally, the CRM's data store is a JSON file (`.data/db.json`) written to local disk. That's fine for `npm run dev` on your laptop, but it does not work as a production data store on Vercel:

- Vercel's serverless functions have an ephemeral, per-invocation filesystem. A fresh cold start has no memory of a previous request's writes.
- Two concurrent requests can land on different instances with independent memory — a lead submitted on one instance won't show up on another.

Without a database, every cold start resets the CRM back to seed data, and a lead submitted five minutes before a demo could simply be gone.

The fix is already built in: set `DATABASE_URL` and the store persists to Postgres instead of a local file — no other code changes needed (`src/domain/persistence.ts`). It's the same one-blob-per-row approach as everything else in this codebase: simulate/fallback until the env var is set, live the moment it is.

## Step 1 — Provision Postgres

1. In the [Vercel dashboard](https://vercel.com/dashboard), open your project → **Storage** → **Create Database** → **Postgres** (this provisions a Neon-backed Postgres instance).
2. Vercel automatically adds a `DATABASE_URL` env var to the project — you don't need to copy/paste a connection string yourself.
3. No schema setup needed — the app creates its one table (`mlh_store`) automatically on first request.

If you'd rather use your own Neon/Supabase/RDS Postgres instance instead of Vercel's, just set `DATABASE_URL` to that connection string in the project's environment variables — anything Postgres-compatible works.

## Step 2 — Connect the repo to Vercel

Pick whichever you're already set up for:

**Option A — GitHub (recommended, enables auto-deploy on push)**
```bash
git remote add origin <your-github-repo-url>
git push -u origin main
```
Then in the Vercel dashboard: **Add New Project** → **Import** your GitHub repo → set the root directory to `web/` if the repo contains more than this app → **Deploy**.

**Option B — Vercel CLI (deploy directly from this machine)**
```bash
vercel login
vercel --cwd web
```
Follow the prompts (link to a new or existing project). Running `vercel --prod` after that promotes the deploy to your production URL.

## Step 3 — Environment variables

In the Vercel project's **Settings → Environment Variables**, set whichever of these you're ready to go live with. Leave any blank and that channel simulates (visible in the DEMO banner and server logs):

| Variable | Powers |
|---|---|
| `DATABASE_URL` | **Required in production** (the app refuses to boot without it — `src/instrumentation.ts`) — set automatically if you provisioned Vercel Postgres in Step 1 |
| `APP_URL` | Base URL used in invite/reset-password email links and the Vapi webhook callback. Leave blank on Vercel — falls back to the auto-populated `VERCEL_URL`. |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_PHONE_NUMBER` | Real SMS + outbound voice — **free trial credit at twilio.com/try-twilio** |
| `ANTHROPIC_API_KEY` | Real AI drafts (email/SMS/call scripts) and conversation extraction — paid, usage-based |
| `NVIDIA_API_KEY` (+ optional `NVIDIA_MODEL`) | **Free-tier alternative to Anthropic** for AI-drafted messages only (call scripts, email/SMS drafts, Reddit signal replies) — get a key at **build.nvidia.com**. If `ANTHROPIC_API_KEY` is set, that's used instead; extraction/classification still need Anthropic specifically. Leave both blank and drafts are a fixed canned message instead of AI-generated — the send still works either way. |
| `RESEND_API_KEY` / `RESEND_FROM_EMAIL` | Real outbound email — also required for real invite/password-reset emails to send |
| `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET` | Real lead discovery search |
| `PROPERTY_DATA_API_KEY` | Real property valuation/AVM via RentCast — **free tier at rentcast.io** (50 requests/month, no card). Only fires for leads with a street address on file. |
| `VAPI_API_KEY` / `VAPI_PHONE_NUMBER_ID` / `VAPI_WEBHOOK_SECRET` | Live AI voice-agent qualification calls — see "Voice AI agent" below. All three are required together. |
| `CRON_SECRET` | **Required in production** — `/api/cron/cadence` now fails closed (401) without it, rather than running unprotected. Set this to any random string and Vercel Cron (already configured in `vercel.json`) sends it automatically. |
| `COMPANY_NMLS_ID` | Your real NMLS ID, shown in the public site footer. Leave unset and the footer visibly says `SET_COMPANY_NMLS_ID` instead of a fake-looking number — set this before sharing the link publicly. |

See `.env.example` for the full list and where to get each key.

### Cron frequency — Hobby vs. Pro

`vercel.json` ships with `"0 8 * * *"` (once daily) because **Vercel's Hobby plan only permits daily cron jobs** — an hourly schedule fails to deploy at all on Hobby. That means each cadence step only gets *checked* once a day by default, not every hour: a step scheduled for "2 hours after intake" might not actually fire until the next day's tick catches up to it. Two ways to get tighter timing:
- Upgrade the Vercel project to **Pro**, which allows per-minute cron schedules — then tighten `vercel.json`'s schedule (e.g. `"0 * * * *"` for hourly).
- Or leave `vercel.json` alone and instead point an **external pinger** (cron-job.org, a GitHub Actions scheduled workflow, etc.) at `/api/cron/cadence` on whatever interval you want, sending `Authorization: Bearer <CRON_SECRET>` — this works on any Vercel plan.

### Voice AI agent (Vapi) setup

1. Create a free account at [vapi.ai](https://vapi.ai) and copy your private API key → `VAPI_API_KEY`.
2. Get a phone number: either buy one in Vapi, or import your existing Twilio number ("BYO number") under Phone Numbers. Copy that number's **id** (not the phone number itself) → `VAPI_PHONE_NUMBER_ID`.
3. Generate any random string (e.g. `openssl rand -hex 32`) → `VAPI_WEBHOOK_SECRET`. This is never sent to Vapi's dashboard directly — the app includes it on every outbound call request, and Vapi echoes it back on every webhook event so `/api/webhooks/vapi` can verify the request is genuine.
4. Set `APP_URL` (or rely on `VERCEL_URL`) so the webhook URL Vapi is told to call resolves correctly.
5. Once all three Vapi env vars are set, the "AI call" button on a lead's detail page places a real outbound call; the transcript streams into the Conversation tab as the call happens, and extraction runs automatically when it ends.

## Step 4 — Verify after deploy

1. Open the deployed `/apply` URL and submit a test inquiry through to the end of the post-submit chat.
2. Go to `/login`, sign in with one of the demo accounts above, and confirm `/workspace/leads` shows the test lead. Visiting `/workspace` while logged out should redirect straight to `/login`.
3. Redeploy or trigger a new cold start (e.g. wait a few minutes and hit the site again) and confirm the lead is *still* there — this is the actual proof the database is wired up, not just that the page renders.
4. Check the Vercel function logs for the deploy — every simulated send logs a `[SIMULATED ...]` line, so you can confirm which channels are live vs. simulated without guessing.
5. Hit `/api/health` — `{"ok":true}` means the app can actually reach the database, not just that it booted. Point an uptime monitor at this URL rather than the homepage, which renders fine even if Postgres is down.

## Known limitations (by design, for today's timeline)

- **Single JSON blob, not a normalized schema.** The Postgres backend stores the whole CRM state as one row, the same shape as the in-memory store. Fastest path to a persistent, working deploy without rewriting the data layer — fine at the current scale. A normalized Prisma/Postgres schema (`SPEC.md` section 4) is the natural next step once the data model stabilizes.
- **Cross-instance writes are last-write-wins, not merged.** Each warm serverless instance caches the whole database in memory and overwrites the full row on every save. If Vercel runs two instances concurrently (more likely under real concurrent traffic than at this app's current scale) and both handle writes for different leads around the same time, the second save can overwrite the first instance's changes. Within a single instance this isn't a concern — same-lead writes are already serialized (`withLeadLock`, `src/domain/store.ts`). Closing this fully means moving off the single-blob model to real per-row writes (the same normalized-schema work above), not a smaller patch.
