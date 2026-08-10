// Voice-agent adapter — SPEC.md F-05, Phase 3. A live conversational
// qualification call (borrower talks to an AI voice agent in real time), via
// Vapi (vapi.ai) — chosen over Retell/raw Twilio Media Streams because Vapi
// handles telephony + STT + LLM + TTS itself and just POSTs structured JSON
// events to a plain HTTPS webhook (see src/app/api/webhooks/vapi/route.ts),
// so this doesn't need a hand-rolled real-time media stream handler.
//
// Requires three things together (capabilities.hasLiveVoiceAgent): an API
// key, a phone number provisioned/imported in Vapi (VAPI_PHONE_NUMBER_ID),
// and a shared secret Vapi echoes back on every webhook call so we can tell
// a request really came from Vapi (VAPI_WEBHOOK_SECRET). Missing any of the
// three simulates, same as every other adapter in this app.

import { getAppUrl, getCapabilities, getConfigValue } from "@/lib/runtimeConfig";
import { classifyFailure, type DeliveryFailure } from "@/core/deliveryStatus";
import type { GoalType, LoanIntent } from "@/domain/types";

export interface PlaceVoiceAgentCallInput {
  leadId: string;
  conversationId: string;
  firstName: string;
  intent: LoanIntent;
  goal: GoalType;
  phoneE164: string;
  /** What has already been said to this borrower on SMS/email/prior calls,
   *  from core/conversationThread. Without it the agent opens every call cold
   *  and re-asks questions the borrower already answered by text — the single
   *  most obvious tell that "one conversation across channels" is a fiction. */
  priorContext?: string;
}

export type PlaceVoiceAgentCallResult =
  | { ok: true; providerCallId: string; simulated: boolean }
  | { ok: false; failure: DeliveryFailure };

// Same hard compliance rules as the outreach-content generator
// (adapters/llm.ts's OUTREACH_SYSTEM_PROMPT) — a live conversational agent
// needs them even more, since there's no officer reviewing what it says
// before it's spoken.
const VOICE_AGENT_SYSTEM_PROMPT = (firstName: string, intentLabel: string, goalLabel: string) =>
  `You are a warm, brief qualification specialist for a licensed mortgage lending desk, calling ${firstName} about their ${intentLabel} inquiry (goal: ${goalLabel}). ` +
  `Hard rules, never break these: never quote a rate, payment amount, or approval odds; never say "you qualify", "you're approved", or "you'll likely get"; ` +
  `never give legal, tax, or financial advice; never ask for SSN, date of birth, or full account numbers. ` +
  `Confirm their timeline, credit range, and property details conversationally, then tell them a licensed loan officer will follow up. ` +
  `If they ask anything outside qualification questions, offer to have a human officer call them back. Keep turns short — this is a phone call, not an essay.`;

export async function voiceAgentStatus(): Promise<{ configured: boolean; live: boolean; note: string }> {
  const caps = await getCapabilities();
  if (caps.hasVoiceAgent) {
    return { configured: true, live: true, note: "Live — outbound calls go through Vapi, transcripts land via webhook." };
  }
  if (caps.hasPartialVoiceAgent) {
    // Previously unreachable: this branch tested hasVoiceAgent again, so an
    // operator who had entered only the API key was told "not configured"
    // rather than which field was still missing.
    return {
      configured: false,
      live: false,
      note: "VAPI_API_KEY is set, but VAPI_PHONE_NUMBER_ID and/or VAPI_WEBHOOK_SECRET are missing — add them in Admin → Integrations.",
    };
  }
  return {
    configured: false,
    live: false,
    note: "Not configured. Set VAPI_API_KEY, VAPI_PHONE_NUMBER_ID, and VAPI_WEBHOOK_SECRET to go live.",
  };
}

export async function placeVoiceAgentCall(input: PlaceVoiceAgentCallInput): Promise<PlaceVoiceAgentCallResult> {
  if (!(await getCapabilities()).hasVoiceAgent) {
    console.log(`[SIMULATED VOICE AGENT] would call ${input.phoneE164} for lead ${input.leadId} (${input.intent}/${input.goal})`);
    return { ok: true, providerCallId: `sim_vapi_${input.leadId}`, simulated: true };
  }

  const intentLabel = input.intent.replace("_", " ").toLowerCase();
  const goalLabel = input.goal.replace("_", " ").toLowerCase();

  try {
    const response = await fetch("https://api.vapi.ai/call", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${await getConfigValue("VAPI_API_KEY")}`,
      },
      body: JSON.stringify({
        phoneNumberId: await getConfigValue("VAPI_PHONE_NUMBER_ID"),
        customer: { number: input.phoneE164 },
        assistant: {
          firstMessage: input.priorContext
            ? `Hi ${input.firstName}, it's Equity Flow Group following up on our earlier messages about your ${intentLabel} — is now a good time?`
            : `Hi ${input.firstName}, this is a quick follow-up on your ${intentLabel} inquiry — got a couple minutes?`,
          model: {
            provider: "openai",
            model: "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content:
                  VOICE_AGENT_SYSTEM_PROMPT(input.firstName, intentLabel, goalLabel) +
                  (input.priorContext
                    ? `\n\nThis is a continuing conversation, not a first contact. Here is what has already been exchanged with ${input.firstName} on other channels, oldest first:\n${input.priorContext}\n\nAcknowledge it naturally. Do not re-ask anything they have already answered, and do not introduce yourself as if this were the first time you have been in touch.`
                    : ""),
              },
            ],
          },
          voice: { provider: "playht", voiceId: "jennifer" },
          transcriber: { provider: "deepgram", model: "nova-2" },
          server: { url: `${await getAppUrl()}/api/webhooks/vapi`, secret: await getConfigValue("VAPI_WEBHOOK_SECRET") },
        },
        metadata: { leadId: input.leadId, conversationId: input.conversationId },
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Vapi call creation failed: ${response.status} ${body}`);
    }
    const data: { id: string } = await response.json();
    return { ok: true, providerCallId: data.id, simulated: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown Vapi error";
    console.error("[Vapi] call failed:", message);
    return { ok: false, failure: classifyFailure("vapi", undefined, message) };
  }
}
