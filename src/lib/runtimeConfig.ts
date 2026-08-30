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
import { resolvePublicAppUrl, type PublicUrlResolution } from "@/core/publicUrl";

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
  /** Telnyx configured deeply enough to place calls, not just send SMS. */
  hasTelnyxVoice: boolean;
  hasSms: boolean;
  hasVoice: boolean;
  hasOpenAi: boolean;
  hasAnthropic: boolean;
  hasNvidia: boolean;
  hasAnyLlm: boolean;
  hasResend: boolean;
  hasInboundEmail: boolean;
  hasVoiceAgent: boolean;
  /** Some, but not all, saved-assistant Vapi fields are present. Distinct from
   *  hasVoiceAgent so the admin panel can name the incomplete setup. */
  hasPartialVoiceAgent: boolean;
  hasLeadDiscovery: boolean;
  hasPropertySearch: boolean;
  hasPropertyData: boolean;
  hasCredit: boolean;
}

/** Freshly computed on every call. Cheap — the store is already in memory
 *  after first load, so this is a handful of Map lookups plus a decrypt. */
export async function getCapabilities(): Promise<RuntimeCapabilities> {
  // "Live" means production two-way messaging, not merely that the send API
  // can accept a request. Requiring the verification key prevents automated
  // cadence from running while inbound STOP and delivery truth are unverifiable.
  const hasTelnyx = await hasAll(["TELNYX_API_KEY", "TELNYX_PHONE_NUMBER", "TELNYX_PUBLIC_KEY"]);
  const hasTwilio = await hasAll(["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER"]);
  const hasOpenAi = await hasAll(["OPENAI_API_KEY"]);
  const hasAnthropic = await hasAll(["ANTHROPIC_API_KEY"]);
  const hasNvidia = await hasAll(["NVIDIA_API_KEY"]);
  const hasResend = await hasAll(["RESEND_API_KEY", "RESEND_FROM_EMAIL"]);
  const vapiKeys = ["VAPI_API_KEY", "VAPI_PHONE_NUMBER_ID", "VAPI_ASSISTANT_ID", "VAPI_WEBHOOK_SECRET"];
  const vapiValues = await Promise.all(vapiKeys.map((key) => getConfigValue(key)));
  const hasVoiceAgent = vapiValues.every(Boolean);
  const hasPartialVoiceAgent = vapiValues.some(Boolean) && !hasVoiceAgent;

  // Telnyx voice needs strictly more than Telnyx SMS: TeXML fetches the call
  // script over HTTP rather than accepting it inline, which requires a TeXML
  // Application and the account id. Each announcement is protected by a
  // short-lived, per-call capability token generated at placement time.
  // Treating "Telnyx configured" as "Telnyx can call" was the original
  // bug — SMS worked, voice silently stayed simulated, and nothing said why.
  const hasTelnyxVoice = hasTelnyx && (await hasAll(["TELNYX_ACCOUNT_SID", "TELNYX_TEXML_APP_ID"]));

  return {
    hasTelnyx,
    hasTwilio,
    hasTelnyxVoice,
    hasSms: hasTelnyx || hasTwilio,
    hasVoice: hasTwilio || hasTelnyxVoice,
    hasOpenAi,
    hasAnthropic,
    hasNvidia,
    hasAnyLlm: hasOpenAi || hasAnthropic || hasNvidia,
    hasResend,
    hasInboundEmail: hasResend && (await hasAll(["RESEND_REPLY_TO_EMAIL", "RESEND_INBOUND_WEBHOOK_SECRET"])),
    hasVoiceAgent,
    hasPartialVoiceAgent,
    // Arctic Shift is a public, read-only, no-auth source. Reddit OAuth and
    // commercial approval are required for publishing, not retrieval.
    hasLeadDiscovery: true,
    hasPropertySearch: await hasAll(["BRAVE_SEARCH_API_KEY"]),
    hasPropertyData: await hasAll(["PROPERTY_DATA_API_KEY"]),
    hasCredit:
      (await hasAll(["ISOFTPULL_API_KEY", "ISOFTPULL_API_SECRET"])) &&
      (await getConfigValue("CREDIT_LIVE_APPROVED")) === "true",
  };
}

/** Public base URL resolution for diagnostics and all provider callbacks. */
export async function getPublicUrlResolution(): Promise<PublicUrlResolution> {
  const configured = await getConfigValue("APP_URL");
  return resolvePublicAppUrl({
    configured,
    vercelProductionUrl: process.env.VERCEL_PROJECT_PRODUCTION_URL,
    vercelDeploymentUrl: process.env.VERCEL_URL,
  });
}

/** Always returns a syntactically valid origin, even if a legacy Admin value
 * is malformed. This keeps metadata and webhook generation available while
 * the Admin corrects the stored field. */
export async function getAppUrl(): Promise<string> {
  return (await getPublicUrlResolution()).url;
}
