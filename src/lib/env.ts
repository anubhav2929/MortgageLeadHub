// Runtime configuration. Every provider key is optional — absence means the
// matching adapter runs in simulated mode (SPEC.md adapters/ pattern: no
// route handler ever touches a vendor SDK directly, only adapters do).
// Drop real keys into `.env.local` and the matching channel goes live with
// no code changes.

import { z } from "zod";

// Vercel's Postgres integrations commonly expose POSTGRES_URL, while Neon,
// Supabase, and manually configured projects tend to use DATABASE_URL. Accept
// both names so attaching a Vercel database cannot accidentally put a
// production deployment into the non-persistent local-file fallback.
function getDatabaseUrl(): string | undefined {
  return [process.env.DATABASE_URL, process.env.POSTGRES_URL, process.env.POSTGRES_URL_NON_POOLING].find((value) => value?.trim());
}

const databaseUrl = getDatabaseUrl();

const envSchema = z.object({
  DATABASE_URL: z.string().optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_PHONE_NUMBER: z.string().optional(),
  TELNYX_API_KEY: z.string().optional(),
  TELNYX_PHONE_NUMBER: z.string().optional(),
  TELNYX_MESSAGING_PROFILE_ID: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  NVIDIA_API_KEY: z.string().optional(),
  NVIDIA_MODEL: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().optional(),
  RESEND_INBOUND_WEBHOOK_SECRET: z.string().optional(),
  VAPI_API_KEY: z.string().optional(),
  VAPI_PHONE_NUMBER_ID: z.string().optional(),
  VAPI_WEBHOOK_SECRET: z.string().optional(),
  RETELL_API_KEY: z.string().optional(),
  PROPERTY_DATA_API_KEY: z.string().optional(),
  SUPABASE_CA_CERT: z.string().optional(),
  CRON_SECRET: z.string().optional(),
  APP_URL: z.string().optional(),
  VERCEL_URL: z.string().optional(),
  COMPANY_NMLS_ID: z.string().optional(),
});

const parsed = envSchema.safeParse({
  DATABASE_URL: databaseUrl,
  TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
  TWILIO_PHONE_NUMBER: process.env.TWILIO_PHONE_NUMBER,
  TELNYX_API_KEY: process.env.TELNYX_API_KEY,
  TELNYX_PHONE_NUMBER: process.env.TELNYX_PHONE_NUMBER,
  TELNYX_MESSAGING_PROFILE_ID: process.env.TELNYX_MESSAGING_PROFILE_ID,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  NVIDIA_API_KEY: process.env.NVIDIA_API_KEY,
  NVIDIA_MODEL: process.env.NVIDIA_MODEL,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL,
  RESEND_INBOUND_WEBHOOK_SECRET: process.env.RESEND_INBOUND_WEBHOOK_SECRET,
  VAPI_API_KEY: process.env.VAPI_API_KEY,
  VAPI_PHONE_NUMBER_ID: process.env.VAPI_PHONE_NUMBER_ID,
  VAPI_WEBHOOK_SECRET: process.env.VAPI_WEBHOOK_SECRET,
  RETELL_API_KEY: process.env.RETELL_API_KEY,
  PROPERTY_DATA_API_KEY: process.env.PROPERTY_DATA_API_KEY,
  SUPABASE_CA_CERT: process.env.SUPABASE_CA_CERT,
  CRON_SECRET: process.env.CRON_SECRET,
  APP_URL: process.env.APP_URL,
  VERCEL_URL: process.env.VERCEL_URL,
  COMPANY_NMLS_ID: process.env.COMPANY_NMLS_ID,
});

if (!parsed.success) {
  console.error("[env] invalid environment configuration:", parsed.error.flatten());
}

export const env = parsed.success ? parsed.data : envSchema.parse({});

/** The app's public base URL — used for links in emails (invite/reset) and
 *  for the Vapi webhook callback URL. Falls back to Vercel's auto-populated
 *  VERCEL_URL, then localhost for dev. */
export function getAppUrl(): string {
  if (env.APP_URL) return env.APP_URL.replace(/\/$/, "");
  if (env.VERCEL_URL) return `https://${env.VERCEL_URL}`;
  return "http://localhost:3000";
}

export const capabilities = {
  hasDatabase: Boolean(env.DATABASE_URL),
  hasTwilio: Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_PHONE_NUMBER),
  hasTelnyx: Boolean(env.TELNYX_API_KEY && env.TELNYX_PHONE_NUMBER),
  // Either carrier lights up SMS/voice; adapters/sms.ts and adapters/voice.ts
  // prefer Telnyx when both are configured (cheaper, native 10DLC — see the
  // vendor comparison in DEPLOY.md), falling back to Twilio, then simulated.
  hasAnthropic: Boolean(env.ANTHROPIC_API_KEY),
  hasNvidia: Boolean(env.NVIDIA_API_KEY),
  hasResend: Boolean(env.RESEND_API_KEY),
  // Requires the webhook secret too, same fail-closed pattern as
  // hasLiveVoiceAgent — the inbound route rejects everything without it.
  hasInboundEmail: Boolean(env.RESEND_API_KEY && env.RESEND_INBOUND_WEBHOOK_SECRET),
  hasVoiceAgent: Boolean(env.VAPI_API_KEY || env.RETELL_API_KEY),
  // The full, genuinely-callable Vapi setup — see adapters/voiceAgent.ts.
  hasLiveVoiceAgent: Boolean(env.VAPI_API_KEY && env.VAPI_PHONE_NUMBER_ID && env.VAPI_WEBHOOK_SECRET),
  // No credential gate: discovery reads a public archive (Arctic Shift) that
  // needs no auth, so this capability is always live. Reddit's /prefs/apps
  // registration is no longer dependable, which is precisely why it is not a
  // dependency any more. See adapters/leadDiscovery.ts.
  hasLeadDiscovery: true,
  hasPropertyData: Boolean(env.PROPERTY_DATA_API_KEY),
};

let announced = false;
export function announceCapabilitiesOnce() {
  if (announced) return;
  announced = true;
  const lines = [
    `Database: ${capabilities.hasDatabase ? "Postgres (DATABASE_URL)" : "local file — .data/db.json (set DATABASE_URL for persistence on Vercel)"}`,
    `SMS/Voice: ${
      capabilities.hasTelnyx
        ? "LIVE (Telnyx)"
        : capabilities.hasTwilio
          ? "LIVE (Twilio)"
          : "simulated — set TELNYX_API_KEY/TELNYX_PHONE_NUMBER or TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_PHONE_NUMBER"
    }`,
    `Extraction (Anthropic): ${capabilities.hasAnthropic ? "LIVE" : "simulated — set ANTHROPIC_API_KEY"}`,
    `AI messaging (outreach drafts & signal replies): ${capabilities.hasAnthropic ? "LIVE (Anthropic)" : capabilities.hasNvidia ? "LIVE (NVIDIA NIM, free tier)" : "simulated — set ANTHROPIC_API_KEY or NVIDIA_API_KEY"}`,
    `Email (Resend): ${capabilities.hasResend ? "LIVE" : "simulated — set RESEND_API_KEY"}`,
    `Inbound email (Resend receiving): ${capabilities.hasInboundEmail ? "LIVE — webhook wired at /api/webhooks/resend-inbound" : "not configured — set RESEND_INBOUND_WEBHOOK_SECRET and add the webhook in the Resend dashboard (see DEPLOY.md)"}`,
    `Voice AI agent (Vapi): ${capabilities.hasLiveVoiceAgent ? "LIVE — outbound calls + webhook wired" : capabilities.hasVoiceAgent ? "API key present but VAPI_PHONE_NUMBER_ID/VAPI_WEBHOOK_SECRET missing — see adapters/voiceAgent.ts" : "not configured — set VAPI_API_KEY, VAPI_PHONE_NUMBER_ID, VAPI_WEBHOOK_SECRET"}`,
    `Lead discovery (Arctic Shift public archive): LIVE — no credentials required`,
    `Property valuation/AVM (RentCast): ${capabilities.hasPropertyData ? "LIVE for leads with a street address, simulated otherwise" : "simulated — set PROPERTY_DATA_API_KEY (free tier at rentcast.io)"}`,
    `Automated cadence engine: endpoint ready at /api/cron/cadence (${env.CRON_SECRET ? "protected by CRON_SECRET" : "UNPROTECTED — set CRON_SECRET before scheduling it"}) — needs a scheduler (Vercel Cron or an external pinger) actually hitting it; see vercel.json.`,
  ];
  console.log(`\n[Equity Flow Group] Provider status:\n  ${lines.join("\n  ")}\n`);
}
