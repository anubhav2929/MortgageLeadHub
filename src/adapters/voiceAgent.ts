// Minimal Vapi outbound-call adapter.
//
// The assistant's voice, model, transcriber, tools, server events, endpointing,
// and prompt are owned and published in Vapi. The CRM deliberately sends only
// the saved assistant/phone IDs, the destination, correlation metadata, and
// bounded per-call variables. Keeping provider configuration out of this
// request prevents optional Vapi schema changes from breaking call creation.

import { getCapabilities, getConfigValue } from "@/lib/runtimeConfig";
import { classifyFailure, type DeliveryFailure } from "@/core/deliveryStatus";
import { classifyVapiCreateError } from "@/core/vapiLifecycle";
import type { GoalType, LeadContextSnapshot, LoanIntent, QualificationQuestionId } from "@/domain/types";

export interface PlaceVoiceAgentCallInput {
  leadId: string;
  conversationId: string;
  firstName: string;
  lastName?: string;
  city?: string;
  intent: LoanIntent;
  goal: GoalType;
  phoneE164: string;
  priorContext?: string;
  contextSnapshot?: LeadContextSnapshot;
  initialQuestionId?: QualificationQuestionId;
}

export interface VapiSavedAssistantCallPayload {
  assistantId: string;
  phoneNumberId: string;
  customer: { number: string };
  assistantOverrides: { variableValues: Record<string, string> };
  metadata: { leadId: string; conversationId: string };
}

export interface VoiceAgentProfileSnapshot extends Record<string, unknown> {
  provider: "vapi";
  configurationMode: "saved-assistant";
  assistantId?: string;
  phoneNumberId?: string;
  promptVersionId: string;
  variableNames: string[];
}

export type PlaceVoiceAgentCallResult =
  | {
      ok: true;
      providerCallId: string;
      simulated: boolean;
      listenUrl?: string;
      controlUrl?: string;
      profileSnapshot: VoiceAgentProfileSnapshot;
    }
  | { ok: false; failure: DeliveryFailure };

export const VOICE_PROMPT_VERSION = "vapi_saved_assistant_v1";

function boundedVariable(value: string | undefined, maximum: number): string | undefined {
  const cleaned = value
    ?.replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
  return cleaned || undefined;
}

function boundedContextVariable(value: string | undefined, maximum: number): string | undefined {
  return boundedVariable(
    value
      ?.replaceAll("<", "[")
      .replaceAll(">", "]")
      .replaceAll("{{", "{ {")
      .replaceAll("}}", "} }"),
    maximum
  );
}

/** Pure builder pinned by tests so optional provider configuration cannot
 * quietly creep back into the create-call request. */
export function buildVapiSavedAssistantCallPayload(input: PlaceVoiceAgentCallInput & {
  assistantId: string;
  phoneNumberId: string;
}): VapiSavedAssistantCallPayload {
  const firstName = boundedVariable(input.firstName, 80) ?? "there";
  const lastName = boundedVariable(input.lastName, 80);
  const fullName = [firstName, lastName].filter(Boolean).join(" ");
  const variables = Object.fromEntries(
    Object.entries({
      firstName,
      lastName,
      fullName,
      city: boundedVariable(input.city, 120),
      intent: input.intent.replaceAll("_", " ").toLowerCase(),
      goal: input.goal.replaceAll("_", " ").toLowerCase(),
      priorContext: boundedContextVariable(input.priorContext, 8_000),
      initialQuestionId: input.initialQuestionId,
      contextVersion: input.contextSnapshot?.contextVersion,
      questionPlanVersion: input.contextSnapshot?.questionPlanVersion,
      contextCompleteness: input.contextSnapshot ? String(input.contextSnapshot.completenessPercentage) : undefined,
    }).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0)
  );

  return {
    assistantId: input.assistantId,
    phoneNumberId: input.phoneNumberId,
    customer: { number: input.phoneE164 },
    assistantOverrides: { variableValues: variables },
    metadata: { leadId: input.leadId, conversationId: input.conversationId },
  };
}

export async function getVoiceAgentProfile(): Promise<VoiceAgentProfileSnapshot> {
  return {
    provider: "vapi",
    configurationMode: "saved-assistant",
    assistantId: await getConfigValue("VAPI_ASSISTANT_ID"),
    phoneNumberId: await getConfigValue("VAPI_PHONE_NUMBER_ID"),
    promptVersionId: VOICE_PROMPT_VERSION,
    variableNames: ["firstName", "lastName", "fullName", "city", "intent", "goal", "priorContext", "initialQuestionId", "contextVersion", "questionPlanVersion", "contextCompleteness"],
  };
}

async function missingVapiKeys(): Promise<string[]> {
  const keys = ["VAPI_API_KEY", "VAPI_PHONE_NUMBER_ID", "VAPI_ASSISTANT_ID", "VAPI_WEBHOOK_SECRET"];
  const values = await Promise.all(keys.map((key) => getConfigValue(key)));
  return keys.filter((_, index) => !values[index]);
}

export async function voiceAgentStatus(): Promise<{ configured: boolean; live: boolean; note: string }> {
  const missing = await missingVapiKeys();
  if (missing.length === 0) {
    return { configured: true, live: true, note: "Live — outbound calls use the published Vapi assistant; transcripts return by webhook." };
  }
  return {
    configured: false,
    live: false,
    note: `Not ready. Add ${missing.join(", ")} in Admin → Integrations.`,
  };
}

export async function placeVoiceAgentCall(input: PlaceVoiceAgentCallInput): Promise<PlaceVoiceAgentCallResult> {
  const profile = await getVoiceAgentProfile();
  if (!(await getCapabilities()).hasVoiceAgent) {
    console.log(`[SIMULATED VOICE AGENT] leadId=${input.leadId}`);
    return { ok: true, providerCallId: `sim_vapi_${input.leadId}`, simulated: true, profileSnapshot: profile };
  }

  if (!/^\+[1-9]\d{7,14}$/.test(input.phoneE164)) {
    return {
      ok: false,
      failure: { class: "PERMANENT", message: "The borrower phone number is not valid E.164.", affectsAllLeads: false },
    };
  }

  const apiKey = await getConfigValue("VAPI_API_KEY");
  const assistantId = profile.assistantId;
  const phoneNumberId = profile.phoneNumberId;
  if (!apiKey || !assistantId || !phoneNumberId) {
    return {
      ok: false,
      failure: { class: "CONFIGURATION", message: `Vapi is missing ${(await missingVapiKeys()).join(", ")}.`, affectsAllLeads: true },
    };
  }

  const payload = buildVapiSavedAssistantCallPayload({ ...input, assistantId, phoneNumberId });

  try {
    const response = await fetch("https://api.vapi.ai/call", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) {
      const body = await response.text();
      const { failureClass, detail } = classifyVapiCreateError(response.status, body);
      console.error(`[Vapi] call creation refused (${failureClass}):`, detail);
      return {
        ok: false,
        failure: { class: failureClass, message: `${detail} (HTTP ${response.status})`, affectsAllLeads: failureClass === "CONFIGURATION" },
      };
    }

    const data: { id?: string; monitor?: { listenUrl?: string; controlUrl?: string } } = await response.json();
    if (!data.id) {
      return { ok: false, failure: { class: "TRANSIENT", message: "Vapi accepted the call but returned no call ID.", affectsAllLeads: false } };
    }
    return {
      ok: true,
      providerCallId: data.id,
      simulated: false,
      listenUrl: data.monitor?.listenUrl,
      controlUrl: data.monitor?.controlUrl,
      profileSnapshot: profile,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Vapi error";
    console.error("[Vapi] call failed:", message);
    return { ok: false, failure: classifyFailure("vapi", undefined, message) };
  }
}
