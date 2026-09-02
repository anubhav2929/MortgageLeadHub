export interface VapiAssistantConfiguration {
  server?: { url?: string; credentialId?: string };
  serverUrl?: string;
  serverMessages?: string[];
  artifactPlan?: {
    loggingEnabled?: boolean;
    transcriptPlan?: { enabled?: boolean };
  };
}

const REQUIRED_EVENTS = ["status-update", "end-of-call-report"];
const TRANSCRIPT_EVENTS = ["transcript", 'transcript[transcriptType="final"]', "conversation-update"];

function normalizedUrl(value: string | undefined): string {
  return value?.trim().replace(/\/+$/, "") ?? "";
}

/** Validate the account-side settings that credential-only health checks
 * cannot prove. A callable assistant with no CRM events is not operational:
 * it creates a real phone call but leaves no transcript or settled call log. */
export function evaluateVapiAssistantSetup(
  assistant: VapiAssistantConfiguration,
  expectedWebhookUrl: string
): { ok: true } | { ok: false; issues: string[] } {
  const issues: string[] = [];
  const serverUrl = normalizedUrl(assistant.server?.url ?? assistant.serverUrl);
  if (serverUrl !== normalizedUrl(expectedWebhookUrl)) {
    issues.push(`assistant Server URL must be ${normalizedUrl(expectedWebhookUrl)}`);
  }
  if (!assistant.server?.credentialId) {
    issues.push("assistant Server URL must use a Vapi Custom Credential");
  }

  const events = new Set(assistant.serverMessages ?? []);
  const missing = REQUIRED_EVENTS.filter((event) => !events.has(event));
  if (!TRANSCRIPT_EVENTS.some((event) => events.has(event))) missing.push("transcript");
  if (missing.length > 0) issues.push(`enable server events: ${missing.join(", ")}`);
  if (assistant.artifactPlan?.transcriptPlan?.enabled === false) issues.push("artifact transcript generation is disabled");
  if (assistant.artifactPlan?.loggingEnabled === false) issues.push("artifact call logging is disabled");

  return issues.length > 0 ? { ok: false, issues } : { ok: true };
}
