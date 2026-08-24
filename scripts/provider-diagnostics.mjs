import { createDecipheriv, scryptSync } from "node:crypto";
import process from "node:process";
import pg from "pg";

const databaseUrl = process.env.DIRECT_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
if (!databaseUrl) throw new Error("A database URL is required for provider diagnostics");
const url = new URL(databaseUrl);
const isSupabase = url.hostname.endsWith(".supabase.com");
const supabaseCa = process.env.SUPABASE_CA_CERT?.replace(/\\n/g, "\n");
const databaseCa = process.env.DATABASE_CA_CERT?.replace(/\\n/g, "\n");
url.searchParams.delete("sslmode");
const client = new pg.Client({ connectionString: url.toString(), ssl: { ...(isSupabase ? { ca: supabaseCa } : databaseCa ? { ca: databaseCa } : {}), rejectUnauthorized: true } });

function decrypt(payload) {
  try {
    if (!payload?.startsWith("v1:") || !process.env.CREDENTIAL_SECRET) return null;
    const raw = Buffer.from(payload.slice(3), "base64");
    const key = scryptSync(process.env.CREDENTIAL_SECRET, "equity-flow-group.credential.v1", 32);
    const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

async function check(url, headers) {
  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(12_000) });
    return { reachable: true, authenticated: response.ok, status: response.status };
  } catch (error) {
    return { reachable: false, authenticated: false, error: error instanceof Error ? error.name : "request_failed" };
  }
}

await client.connect();
try {
  const row = (await client.query("SELECT value FROM mlh_store WHERE key='main'")).rows[0];
  if (!row) throw new Error("CRM snapshot not found");
  const credentials = new Map(Array.isArray(row.value.credentials) ? row.value.credentials : []);
  const value = (key) => process.env[key] || decrypt(credentials.get(key)?.value) || undefined;

  const telnyxKey = value("TELNYX_API_KEY");
  const vapiKey = value("VAPI_API_KEY");
  const resendKey = value("RESEND_API_KEY");
  const openAiKey = value("OPENAI_API_KEY");
  const anthropicKey = value("ANTHROPIC_API_KEY");
  const nvidiaKey = value("NVIDIA_API_KEY");

  const diagnostics = {
    database: { connected: true, engine: isSupabase ? "supabase-postgres" : "postgres" },
    telnyx: {
      configured: Boolean(telnyxKey && value("TELNYX_PHONE_NUMBER")),
      messagingProfileConfigured: Boolean(value("TELNYX_MESSAGING_PROFILE_ID")),
      signedWebhookKeyConfigured: Boolean(value("TELNYX_PUBLIC_KEY")),
      api: telnyxKey ? await check("https://api.telnyx.com/v2/phone_numbers?page[size]=1", { Authorization: `Bearer ${telnyxKey}` }) : null,
    },
    vapi: {
      configured: Boolean(vapiKey && value("VAPI_PHONE_NUMBER_ID") && value("VAPI_WEBHOOK_SECRET")),
      customCredentialConfigured: Boolean(value("VAPI_WEBHOOK_CREDENTIAL_ID")),
      api: vapiKey ? await check("https://api.vapi.ai/phone-number", { Authorization: `Bearer ${vapiKey}` }) : null,
    },
    email: {
      configured: Boolean(resendKey && (value("RESEND_FROM_EMAIL") || row.value.config?.senderEmail)),
      inboundWebhookConfigured: Boolean(value("RESEND_INBOUND_WEBHOOK_SECRET")),
      deliveryWebhookConfigured: Boolean(value("RESEND_WEBHOOK_SECRET")),
      api: resendKey ? await check("https://api.resend.com/domains", { Authorization: `Bearer ${resendKey}` }) : null,
    },
    ai: {
      priority: value("AI_PROVIDER_PRIORITY") || "OPENAI,ANTHROPIC,NVIDIA",
      openai: openAiKey ? await check("https://api.openai.com/v1/models", { Authorization: `Bearer ${openAiKey}` }) : null,
      anthropic: anthropicKey ? await check("https://api.anthropic.com/v1/models?limit=1", { "x-api-key": anthropicKey, "anthropic-version": "2023-06-01" }) : null,
      nvidia: nvidiaKey ? await check("https://integrate.api.nvidia.com/v1/models", { Authorization: `Bearer ${nvidiaKey}` }) : null,
    },
  };
  console.log(`PROVIDER_DIAGNOSTICS=${JSON.stringify(diagnostics)}`);
} finally {
  await client.end();
}
