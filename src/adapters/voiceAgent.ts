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

import { capabilities, env, getAppUrl } from "@/lib/env";
import type { GoalType, LoanIntent } from "@/domain/types";

export interface PlaceVoiceAgentCallInput {
  leadId: string;
  conversationId: string;
  firstName: string;
  intent: LoanIntent;
  goal: GoalType;
  phoneE164: string;
}

export interface PlaceVoiceAgentCallResult {
  providerCallId: string;
  simulated: boolean;
  error?: string;
}

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

export function voiceAgentStatus(): { configured: boolean; live: boolean; note: string } {
  return {
    configured: capabilities.hasVoiceAgent,
    live: capabilities.hasLiveVoiceAgent,
    note: capabilities.hasLiveVoiceAgent
      ? "Live — outbound calls go through Vapi, transcripts land via webhook."
      : capabilities.hasVoiceAgent
        ? "VAPI_API_KEY is set, but VAPI_PHONE_NUMBER_ID and/or VAPI_WEBHOOK_SECRET are missing — see adapters/voiceAgent.ts."
        : "Not configured. Set VAPI_API_KEY, VAPI_PHONE_NUMBER_ID, and VAPI_WEBHOOK_SECRET to go live.",
  };
}

export async function placeVoiceAgentCall(input: PlaceVoiceAgentCallInput): Promise<PlaceVoiceAgentCallResult> {
  if (!capabilities.hasLiveVoiceAgent) {
    console.log(`[SIMULATED VOICE AGENT] would call ${input.phoneE164} for lead ${input.leadId} (${input.intent}/${input.goal})`);
    return { providerCallId: `sim_vapi_${input.leadId}`, simulated: true };
  }

  const intentLabel = input.intent.replace("_", " ").toLowerCase();
  const goalLabel = input.goal.replace("_", " ").toLowerCase();

  try {
    const response = await fetch("https://api.vapi.ai/call", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.VAPI_API_KEY!}`,
      },
      body: JSON.stringify({
        phoneNumberId: env.VAPI_PHONE_NUMBER_ID,
        customer: { number: input.phoneE164 },
        assistant: {
          firstMessage: `Hi ${input.firstName}, this is a quick follow-up on your ${intentLabel} inquiry — got a couple minutes?`,
          model: {
            provider: "openai",
            model: "gpt-4o-mini",
            messages: [{ role: "system", content: VOICE_AGENT_SYSTEM_PROMPT(input.firstName, intentLabel, goalLabel) }],
          },
          voice: { provider: "playht", voiceId: "jennifer" },
          transcriber: { provider: "deepgram", model: "nova-2" },
          server: { url: `${getAppUrl()}/api/webhooks/vapi`, secret: env.VAPI_WEBHOOK_SECRET },
        },
        metadata: { leadId: input.leadId, conversationId: input.conversationId },
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Vapi call creation failed: ${response.status} ${body}`);
    }
    const data: { id: string } = await response.json();
    return { providerCallId: data.id, simulated: false };
  } catch (err) {
    const error = err instanceof Error ? err.message : "Unknown Vapi error";
    console.error("[Vapi] call failed:", error);
    return { providerCallId: `failed_${input.leadId}`, simulated: false, error };
  }
}
