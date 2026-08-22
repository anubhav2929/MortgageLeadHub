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
import { classifyVapiCreateError } from "@/core/vapiLifecycle";
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
  | {
      ok: true;
      providerCallId: string;
      simulated: boolean;
      /** WebSocket streaming live call audio, for supervisor listen-in. */
      listenUrl?: string;
      /** Accepts say / add-message / mute / transfer / end-call while live. */
      controlUrl?: string;
    }
  | { ok: false; failure: DeliveryFailure };

// Same hard compliance rules as the outreach-content generator
// (adapters/llm.ts's OUTREACH_SYSTEM_PROMPT) — a live conversational agent
// needs them even more, since there's no officer reviewing what it says
// before it's spoken.
/** Vapi's own curated voice set needs no separate provider account. Override
 *  with VAPI_VOICE_ID (Elliot, Savannah, Rohan, Emma, Clara, Nico, Kai…). */
const DEFAULT_VAPI_VOICE = "Savannah";

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
  const webhookSecret = await getConfigValue("VAPI_WEBHOOK_SECRET");

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
          // Vapi's OWN voices — no third-party credential required.
          //
          // This was `playht/jennifer`, which is a bring-your-own-credential
          // provider. On an account with no PlayHT key every outbound call
          // died at 0 seconds with "Playht unknown error" before the phone
          // ever rang. Nothing in our logs distinguished that from a bad
          // number, because the call never reached a state that reports one.
          //
          // Choosing a provider the customer must separately sign up for is a
          // dependency we imposed on them for no benefit. Vapi's built-in
          // voices work on any account with a Vapi key and nothing else.
          voice: {
            provider: "vapi",
            voiceId: (await getConfigValue("VAPI_VOICE_ID")) || DEFAULT_VAPI_VOICE,
          },
          // Transcriber intentionally omitted so Vapi applies its own bundled
          // default. Pinning `deepgram/nova-2` explicitly is what produced the
          // `call.start.error-get-transcriber` failures — an explicit provider
          // is resolved against account credentials, while the default is not.
          // Declared explicitly rather than relying on the provider's default
          // set. Vapi documents "transcript" as one of many optional server
          // messages, and an assistant that does not ask for it receives only
          // the end-of-call report — which means the live call board sits on
          // "waiting for the first words" for the entire call and only fills
          // in once the borrower has already hung up.
          //
          // status-update is what actually drives the call through
          // queued -> ringing -> in-progress; without it the session stays on
          // whatever we optimistically set when we placed the call.
          serverMessages: ["status-update", "transcript", "end-of-call-report", "hang"],
          server: {
            url: `${await getAppUrl()}/api/webhooks/vapi`,
            // `secret` alone makes Vapi send x-vapi-signature (an HMAC), NOT
            // x-vapi-secret. Sending the plaintext header explicitly as well
            // means the callback authenticates whichever style the account
            // uses. The receiver accepts both — see the webhook route.
            secret: webhookSecret,
            headers: webhookSecret ? { "x-vapi-secret": webhookSecret } : undefined,
          },
        },
        metadata: { leadId: input.leadId, conversationId: input.conversationId },
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      // Classified here, where the HTTP status is still available. Falling
      // through to the generic handler below marked every Vapi error
      // TRANSIENT — so a hard daily-quota wall was redialled on every cadence
      // tick, and the operator saw four identical failures with a badge
      // saying it would be retried.
      const { failureClass, detail } = classifyVapiCreateError(response.status, body);
      console.error(`[Vapi] call creation refused (${failureClass}):`, detail);
      return {
        ok: false,
        failure: {
          class: failureClass,
          message: `${detail} (HTTP ${response.status})`,
          affectsAllLeads: failureClass === "CONFIGURATION",
        },
      };
    }
    // Vapi returns a `monitor` object alongside the call id: a WebSocket that
    // streams live audio, and a control URL that can inject a message, mute
    // the assistant, transfer, or end the call mid-conversation. Both are
    // per-call and short-lived, so they have to be captured here — there is no
    // way to reconstruct them later from the call id.
    const data: { id: string; monitor?: { listenUrl?: string; controlUrl?: string } } = await response.json();
    return {
      ok: true,
      providerCallId: data.id,
      simulated: false,
      listenUrl: data.monitor?.listenUrl,
      controlUrl: data.monitor?.controlUrl,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown Vapi error";
    console.error("[Vapi] call failed:", message);
    return { ok: false, failure: classifyFailure("vapi", undefined, message) };
  }
}
