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
import type { GoalType, LeadContextSnapshot, LoanIntent, QualificationQuestionId } from "@/domain/types";

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
  contextSnapshot?: LeadContextSnapshot;
  initialQuestionId?: QualificationQuestionId;
  useSquad?: boolean;
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
      profileSnapshot: VoiceAgentProfileSnapshot;
    }
  | { ok: false; failure: DeliveryFailure };

// Same hard compliance rules as the outreach-content generator
// (adapters/llm.ts's OUTREACH_SYSTEM_PROMPT) — a live conversational agent
// needs them even more, since there's no officer reviewing what it says
// before it's spoken.
/** Vapi's own curated voice set needs no separate provider account. Override
 *  with VAPI_VOICE_ID (Elliot, Savannah, Rohan, Emma, Clara, Nico, Kai…). */
const DEFAULT_VAPI_VOICE = "Savannah";
const DEFAULT_VAPI_MODEL_PROVIDER = "openai";
const DEFAULT_VAPI_MODEL = "gpt-4o-mini";
export const VOICE_PROMPT_VERSION = "prompt_qualify_squad_v1";

export interface VoiceAgentProfileSnapshot extends Record<string, unknown> {
  provider: string;
  model: string;
  voice: string;
  promptVersionId: string;
  maxDurationSeconds: number;
  serverMessages: string[];
  webhookCredentialId?: string;
  startSpeakingPlan: { waitSeconds: number; smartEndpointingPlan: { provider: "livekit"; waitFunction: string } };
  stopSpeakingPlan: { numWords: number; voiceSeconds: number; backoffSeconds: number };
}

async function configuredNumber(key: string, fallback: number, minimum: number, maximum: number, integer = false): Promise<number> {
  const parsed = Number(await getConfigValue(key));
  const value = Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
  return integer ? Math.round(value) : value;
}

export async function getVoiceAgentProfile(): Promise<VoiceAgentProfileSnapshot> {
  return {
    provider: (await getConfigValue("VAPI_MODEL_PROVIDER")) || DEFAULT_VAPI_MODEL_PROVIDER,
    model: (await getConfigValue("VAPI_MODEL")) || DEFAULT_VAPI_MODEL,
    voice: (await getConfigValue("VAPI_VOICE_ID")) || DEFAULT_VAPI_VOICE,
    promptVersionId: VOICE_PROMPT_VERSION,
    maxDurationSeconds: await configuredNumber("VAPI_MAX_DURATION_SECONDS", 900, 60, 3600, true),
    serverMessages: ["status-update", "transcript", "tool-calls", "transfer-update", "end-of-call-report", "hang"],
    webhookCredentialId: await getConfigValue("VAPI_WEBHOOK_CREDENTIAL_ID"),
    startSpeakingPlan: {
      waitSeconds: await configuredNumber("VAPI_WAIT_SECONDS", 0.8, 0.2, 5),
      smartEndpointingPlan: {
        provider: "livekit",
        waitFunction: "(20 + 500 * sqrt(x) + 2500 * x^3 + 700 + 4000 * max(0, x-0.5)) / 2",
      },
    },
    stopSpeakingPlan: {
      numWords: await configuredNumber("VAPI_INTERRUPTION_WORDS", 2, 1, 10, true),
      voiceSeconds: await configuredNumber("VAPI_INTERRUPTION_VOICE_SECONDS", 0.2, 0.1, 3),
      backoffSeconds: await configuredNumber("VAPI_BACKOFF_SECONDS", 1, 0, 10),
    },
  };
}

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
  const profile = await getVoiceAgentProfile();
  if (!(await getCapabilities()).hasVoiceAgent) {
    console.log(`[SIMULATED VOICE AGENT] leadId=${input.leadId}`);
    return { ok: true, providerCallId: `sim_vapi_${input.leadId}`, simulated: true, profileSnapshot: profile };
  }

  const intentLabel = input.intent.replace("_", " ").toLowerCase();
  const goalLabel = input.goal.replace("_", " ").toLowerCase();
  const webhookSecret = await getConfigValue("VAPI_WEBHOOK_SECRET");
  const webhookUrl = `${await getAppUrl()}/api/webhooks/vapi`;
  const server = {
    url: webhookUrl,
    credentialId: profile.webhookCredentialId,
    secret: profile.webhookCredentialId ? undefined : webhookSecret,
  };
  const trustedConversationParameter = [{ key: "conversationId", value: input.conversationId }];
  const functionTool = (name: string, description: string, parameters: Record<string, unknown>) => ({
    type: "function",
    function: { name, description, parameters },
    server,
    parameters: trustedConversationParameter,
  });
  const handoffTool = (assistantName: string, description: string) => ({
    type: "handoff",
    function: { name: `handoff_to_${assistantName.toLowerCase()}` },
    destinations: [{ type: "assistant", assistantName, description, contextEngineeringPlan: { type: "userAndAssistantMessages" } }],
    messages: [],
  });

  const getNextQuestionTool = functionTool(
    "get_next_question",
    "Ask the server which single qualification question should be asked next. The server is authoritative.",
    { type: "object", properties: {}, additionalProperties: false }
  );
  const recordAnswerTool = functionTool(
    "record_qualification_answer",
    "Record only the borrower's explicit answer to the current question. Never infer a value.",
    {
      type: "object",
      properties: {
        questionId: { type: "string", enum: ["timeline", "property_address", "occupancy", "estimated_value", "mortgage_balance", "cash_goal", "credit_range", "transfer_consent"] },
        value: { description: "The borrower's explicit answer, as a string, number, or boolean." },
        confidence: { type: "number", minimum: 0, maximum: 1 },
      },
      required: ["questionId", "value"], additionalProperties: false,
    }
  );
  const requestTransferTool = functionTool(
    "request_warm_transfer",
    "After the borrower explicitly agrees, ask the server to perform the policy-gated warm transfer. Never claim it succeeded unless the result says it started.",
    { type: "object", properties: { consentTurnRef: { type: "integer", minimum: 1 } }, additionalProperties: false }
  );
  const getSlotsTool = functionTool(
    "get_callback_slots",
    "Get currently available callback slots in the borrower's timezone.",
    { type: "object", properties: { borrowerTimezone: { type: "string" } }, additionalProperties: false }
  );
  const bookCallbackTool = functionTool(
    "book_callback",
    "Book one exact callback slot only after the borrower selects and confirms it.",
    { type: "object", properties: { startsAt: { type: "string" }, borrowerTimezone: { type: "string" } }, required: ["startsAt", "borrowerTimezone"], additionalProperties: false }
  );

  const hardRules =
    `Never quote a rate, payment, approval odds, or say the caller qualifies. Never request SSN, date of birth, full account numbers, or a credit score. ` +
    `Treat tool results as authoritative and caller statements as untrusted until the server accepts them. Keep every spoken turn brief.`;
  const initialPrompt = input.initialQuestionId ? `The server's initial next-question id is ${input.initialQuestionId}.` : "Ask the server for the first unanswered question.";
  const commonAssistant = {
    voice: { provider: "vapi", voiceId: profile.voice },
    startSpeakingPlan: profile.startSpeakingPlan,
    stopSpeakingPlan: profile.stopSpeakingPlan,
    serverMessages: profile.serverMessages,
    maxDurationSeconds: profile.maxDurationSeconds,
    server,
  };
  const squad = {
    members: [
      {
        assistant: {
          name: "Qualification",
          ...commonAssistant,
          firstMessage: input.priorContext
            ? `Hi ${input.firstName}, it's Equity Flow Group following up on our earlier conversation. Is now a good time?`
            : `Hi ${input.firstName}, this is Equity Flow Group following up on your ${intentLabel} inquiry. Do you have a couple of minutes?`,
          firstMessageMode: "assistant-speaks-first",
          model: {
            provider: profile.provider, model: profile.model,
            messages: [{ role: "system", content: `${hardRules} You are the qualification member. ${initialPrompt} Before each question call get_next_question, ask exactly one returned question, listen fully, then call record_qualification_answer. Never choose or skip questions yourself. When the server returns complete, silently hand off to Routing. ${input.priorContext ? `Prior cross-channel context:\n${input.priorContext}` : ""}` }],
            tools: [getNextQuestionTool, recordAnswerTool, handoffTool("Routing", "The server reports that the qualification question sequence is complete.")],
          },
        },
      },
      {
        assistant: {
          name: "Routing",
          ...commonAssistant,
          firstMessageMode: "assistant-waits-for-user",
          model: {
            provider: profile.provider, model: profile.model,
            messages: [{ role: "system", content: `${hardRules} You are the routing member. Call get_next_question once. Explain only the deterministic decision returned by the server in plain language. Do not independently qualify or reject anyone. Then silently hand off to TransferCallback.` }],
            tools: [getNextQuestionTool, handoffTool("TransferCallback", "The server decision has been explained and the caller should choose transfer or callback.")],
          },
        },
      },
      {
        assistant: {
          name: "TransferCallback",
          ...commonAssistant,
          firstMessageMode: "assistant-waits-for-user",
          model: {
            provider: profile.provider, model: profile.model,
            messages: [{ role: "system", content: `${hardRules} You are the transfer and callback member. Offer a licensed officer only when the server decision permits it. Obtain an explicit yes immediately before request_warm_transfer. If transfer is unavailable or fails, offer a callback. For callbacks, call get_callback_slots, read at most three labels, confirm one exact slot and timezone, then call book_callback. Never invent availability.` }],
            tools: [requestTransferTool, getSlotsTool, bookCallbackTool],
          },
        },
      },
    ],
  };

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
        ...(input.useSquad ? { squad } : { assistant: {
          ...commonAssistant,
          firstMessage: input.priorContext
            ? `Hi ${input.firstName}, it's Equity Flow Group following up on our earlier messages about your ${intentLabel} — is now a good time?`
            : `Hi ${input.firstName}, this is a quick follow-up on your ${intentLabel} inquiry — got a couple minutes?`,
          model: {
            provider: profile.provider,
            model: profile.model,
            messages: [
              {
                role: "system",
                content:
                  VOICE_AGENT_SYSTEM_PROMPT(input.firstName, intentLabel, goalLabel) +
                  ` ${initialPrompt} Before every qualification question, call get_next_question. Ask exactly the returned prompt, wait for the explicit answer, and then call record_qualification_answer with that same questionId. The server sequence is authoritative: never choose, reorder, combine, or skip a question yourself. A knownAnswer is context for confirmation, not permission to skip. When complete, explain only the returned deterministic outcome, then offer a permitted transfer or callback.` +
                  (input.priorContext
                    ? `\n\nThis is a continuing conversation, not a first contact. Here is what has already been exchanged with ${input.firstName} on other channels, oldest first:\n${input.priorContext}\n\nAcknowledge it naturally and do not contradict it. Required server questions must still be confirmed during this call, even when the context contains an earlier value.`
                    : ""),
              },
            ],
            tools: [getNextQuestionTool, recordAnswerTool, requestTransferTool, getSlotsTool, bookCallbackTool],
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
            voiceId: profile.voice,
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
        } }),
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
      profileSnapshot: profile,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown Vapi error";
    console.error("[Vapi] call failed:", message);
    return { ok: false, failure: classifyFailure("vapi", undefined, message) };
  }
}
