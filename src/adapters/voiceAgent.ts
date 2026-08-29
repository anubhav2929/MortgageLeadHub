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
import { buildVapiIdentityOpening, buildVapiQualificationSystemPrompt, VAPI_COMPLIANCE_RULES } from "@/core/vapiSystemPrompt";

export interface PlaceVoiceAgentCallInput {
  leadId: string;
  conversationId: string;
  firstName: string;
  lastName?: string;
  city?: string;
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
export const VOICE_PROMPT_VERSION = "prompt_qualify_server_owned_v2";

export interface VoiceAgentProfileSnapshot extends Record<string, unknown> {
  provider: string;
  model: string;
  voice: string;
  voiceProvider: string;
  voiceModel?: string;
  transcriberProvider?: string;
  transcriberModel?: string;
  assistantName: string;
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
    voiceProvider: (await getConfigValue("VAPI_VOICE_PROVIDER")) || "vapi",
    voiceModel: await getConfigValue("VAPI_VOICE_MODEL"),
    transcriberProvider: await getConfigValue("VAPI_TRANSCRIBER_PROVIDER"),
    transcriberModel: await getConfigValue("VAPI_TRANSCRIBER_MODEL"),
    assistantName: (await getConfigValue("VAPI_ASSISTANT_NAME")) || "Anna",
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
  // Vapi's built-in call-control tool. Without it the model can say goodbye
  // but cannot reliably disconnect on a wrong party, opt-out, or completed
  // workflow. It does not call our webhook and therefore needs no server.
  const endCallTool = { type: "endCall" };

  const qualificationPrompt = buildVapiQualificationSystemPrompt({
    firstName: input.firstName,
    lastName: input.lastName,
    city: input.city,
    assistantName: profile.assistantName,
    intentLabel,
    goalLabel,
    priorContext: input.priorContext,
  });
  const identityOpening = buildVapiIdentityOpening({
    assistantName: profile.assistantName,
    firstName: input.firstName,
    lastName: input.lastName,
    city: input.city,
    direction: "OUTBOUND",
  });
  const initialPrompt = input.initialQuestionId ? `The server's initial next-question id is ${input.initialQuestionId}.` : "Ask the server for the first unanswered question.";
  const voice = {
    provider: profile.voiceProvider,
    voiceId: profile.voice,
    ...(profile.voiceModel ? { model: profile.voiceModel } : {}),
  };
  const transcriber = profile.transcriberProvider && profile.transcriberModel
    ? {
        provider: profile.transcriberProvider,
        model: profile.transcriberModel,
        ...(profile.transcriberProvider === "soniox" ? { languages: [] } : {}),
      }
    : undefined;
  const commonAssistant = {
    voice,
    ...(transcriber ? { transcriber } : {}),
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
          firstMessage: identityOpening.firstMessage,
          firstMessageMode: "assistant-speaks-first",
          model: {
            provider: profile.provider, model: profile.model,
            messages: [{ role: "system", content: `${qualificationPrompt}\n\nSQUAD ROLE\nYou are the Qualification member. ${initialPrompt} When get_next_question returns complete, silently hand off to Routing without independently explaining or recalculating the decision.` }],
            tools: [getNextQuestionTool, recordAnswerTool, endCallTool, handoffTool("Routing", "The server reports that the qualification question sequence is complete.")],
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
            messages: [{ role: "system", content: `${VAPI_COMPLIANCE_RULES}\n\nYou are the Routing member. Call get_next_question once. Explain only the deterministic decision returned by the server in neutral language. Never independently qualify, approve, or reject anyone. Then silently hand off to TransferCallback.` }],
            tools: [getNextQuestionTool, endCallTool, handoffTool("TransferCallback", "The server decision has been explained and the caller should choose transfer or callback.")],
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
            messages: [{ role: "system", content: `${VAPI_COMPLIANCE_RULES}\n\nYou are the TransferCallback member. Offer a licensed officer only when the server decision permits it. Obtain explicit consent immediately before request_warm_transfer. Requested or dialing is not a completed bridge. If transfer is unavailable or fails, offer a callback. Call get_callback_slots, read at most three labels, confirm one exact slot and timezone, then call book_callback. Never invent availability or claim success before the tool confirms it.` }],
            tools: [requestTransferTool, getSlotsTool, bookCallbackTool, endCallTool],
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
          firstMessage: identityOpening.firstMessage,
          model: {
            provider: profile.provider,
            model: profile.model,
            messages: [
              {
                role: "system",
                content:
                  `${qualificationPrompt}\n\nSTARTING INSTRUCTION\n${initialPrompt}`,
              },
            ],
            tools: [getNextQuestionTool, recordAnswerTool, requestTransferTool, getSlotsTool, bookCallbackTool, endCallTool],
          },
          // Voice and transcriber are inherited from commonAssistant so the
          // Admin-configured provider pipeline is identical for squads and
          // single-assistant calls. When transcriber fields are blank Vapi's
          // managed default is used, preserving a safe no-BYOK fallback.
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
