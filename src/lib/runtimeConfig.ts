// Resolves provider configuration at call time, not at module load.
// Deployment trigger: keep this runtime resolution server-side on Vercel.
//
// This exists because of a specific bug class. `lib/env.ts` computes its
// `capabilities` object once, when the module is first imported, from
// process.env. That was fine while the only way to configure a provider was
// an env var and a redeploy. It breaks the moment an admin can type a key
// into the app: the key lands in the database, `capabilities.hasTwilio`
// stays false for the life of the process, and the feature silently keeps
// simulating. Every adapter would need a redeploy to notice a key that was
// already saved — the exact round-trip this is meant to remove.
//
// So: DB first, env second, resolved per call.
//
// Two values deliberately stay env-only, because they bootstrap the system
// that stores everything else:
//   DATABASE_URL      — you cannot read the database to find the database.
//   CREDENTIAL_SECRET — the key that decrypts the others cannot live beside them.

import { getDb } from "@/domain/store";
import { decryptSecret } from "@/core/secretBox";

/** One provider value. Database (admin-entered) wins over env, so a key set
 *  in the panel overrides a stale deploy-time variable rather than being
 *  silently ignored by it. */
export async function getConfigValue(key: string): Promise<string | undefined> {
  try {
    const db = await getDb();
    const stored = db.credentials.get(key);
    if (stored) {
      const plain = decryptSecret(stored.value);
      if (plain && plain.trim()) return plain.trim();
      // Undecryptable (CREDENTIAL_SECRET rotated or missing): fall through to
      // env rather than treating the provider as configured-but-broken.
    }
  } catch {
    // Database unreachable during boot — env is the correct fallback.
  }
  const fromEnv = process.env[key];
  return fromEnv && fromEnv.trim() ? fromEnv.trim() : undefined;
}

export async function getConfigValues(keys: string[]): Promise<Record<string, string | undefined>> {
  const out: Record<string, string | undefined> = {};
  for (const k of keys) out[k] = await getConfigValue(k);
  return out;
}

/** True only when every listed key resolves to a non-empty value. */
export async function hasAll(keys: string[]): Promise<boolean> {
  for (const k of keys) {
    if (!(await getConfigValue(k))) return false;
  }
  return true;
}

export interface RuntimeCapabilities {
  hasTelnyx: boolean;
  hasTwilio: boolean;
  hasSms: boolean;
  hasVoice: boolean;
  hasAnthropic: boolean;
  hasNvidia: boolean;
  hasAnyLlm: boolean;
  hasResend: boolean;
  hasInboundEmail: boolean;
  hasVoiceAgent: boolean;
  /** VAPI_API_KEY present but the phone number id and/or webhook secret are
   *  not. Distinct from hasVoiceAgent so the admin panel can name the missing
   *  field instead of saying "not configured" to someone who just entered a key. */
  hasPartialVoiceAgent: boolean;
  hasLeadDiscovery: boolean;
  hasPropertyData: boolean;
}

/** Freshly computed on every call. Cheap — the store is already in memory
 *  after first load, so this is a handful of Map lookups plus a decrypt. */
export async function getCapabilities(): Promise<RuntimeCapabilities> {
  const hasTelnyx = await hasAll(["TELNYX_API_KEY", "TELNYX_PHONE_NUMBER"]);
  const hasTwilio = await hasAll(["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER"]);
  const hasAnthropic = await hasAll(["ANTHROPIC_API_KEY"]);
  const hasNvidia = await hasAll(["NVIDIA_API_KEY"]);
  const hasResend = await hasAll(["RESEND_API_KEY"]);

  return {
    hasTelnyx,
    hasTwilio,
    // SMS can go out over either carrier; voice is Twilio-only today
    // (adapters/voice.ts explains why Telnyx voice needs a hosted XML step).
    hasSms: hasTelnyx || hasTwilio,
    hasVoice: hasTwilio,
    hasAnthropic,
    hasNvidia,
    hasAnyLlm: hasAnthropic || hasNvidia,
    hasResend,
    hasInboundEmail: hasResend && (await hasAll(["RESEND_INBOUND_WEBHOOK_SECRET"])),
    hasVoiceAgent: await hasAll(["VAPI_API_KEY", "VAPI_PHONE_NUMBER_ID", "VAPI_WEBHOOK_SECRET"]),
    hasPartialVoiceAgent:
      (await hasAll(["VAPI_API_KEY"])) && !(await hasAll(["VAPI_PHONE_NUMBER_ID", "VAPI_WEBHOOK_SECRET"])),
    hasLeadDiscovery: await hasAll(["REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET"]),
    hasPropertyData: await hasAll(["PROPERTY_DATA_API_KEY"]),
  };
}

/** Public base URL for email links and webhook callbacks. */
export async function getAppUrl(): Promise<string> {
  const configured = await getConfigValue("APP_URL");
  if (configured) return configured.replace(/\/$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}
