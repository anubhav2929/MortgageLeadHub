// Live control of a call that is already in progress.
//
// Vapi returns a per-call `monitor.controlUrl` when the call is created. POSTing
// to it can make the agent speak, inject context, mute it, hand the call to a
// person, or end it — while the borrower is still on the line.
//
// ---------------------------------------------------------------------------
// Why this is server-only
// ---------------------------------------------------------------------------
// The control URL carries its own authorisation: anyone holding it can speak
// as our brand to a borrower mid-call, or transfer them anywhere. It is a
// bearer credential in URL form. So it is never serialised to the browser —
// the client sends a conversation id, the server looks the URL up. A component
// prop containing controlUrl would put it in the page's HTML payload.

import type { DeliveryFailure } from "@/core/deliveryStatus";

export type CallControlAction =
  | { type: "SAY"; content: string; endCallAfterSpoken?: boolean }
  | { type: "ADD_CONTEXT"; content: string }
  | { type: "MUTE_AGENT" }
  | { type: "UNMUTE_AGENT" }
  | { type: "TRANSFER"; toNumberE164: string; sayFirst?: string }
  | { type: "END_CALL" };

export type CallControlResult = { ok: true } | { ok: false; failure: DeliveryFailure };

const REQUEST_TIMEOUT_MS = 10_000;

/** Translates our vocabulary into Vapi's control payloads. Kept separate from
 *  the transport so the mapping is inspectable and testable. */
export function toVapiControlPayload(action: CallControlAction): Record<string, unknown> {
  switch (action.type) {
    case "SAY":
      return { type: "say", content: action.content, endCallAfterSpoken: action.endCallAfterSpoken ?? false };
    case "ADD_CONTEXT":
      // role "system" rather than "assistant": this is a private instruction
      // for the agent, not words spoken to the borrower. triggerResponse is
      // false so the agent folds it in on its next natural turn instead of
      // interrupting whoever is mid-sentence.
      return {
        type: "add-message",
        message: { role: "system", content: action.content },
        triggerResponseEnabled: false,
      };
    case "MUTE_AGENT":
      return { type: "control", control: "mute-assistant" };
    case "UNMUTE_AGENT":
      return { type: "control", control: "unmute-assistant" };
    case "TRANSFER":
      return {
        type: "transfer",
        destination: { type: "number", number: action.toNumberE164 },
        ...(action.sayFirst ? { content: action.sayFirst } : {}),
      };
    case "END_CALL":
      return { type: "end-call" };
  }
}

export async function controlLiveCall(controlUrl: string, action: CallControlAction): Promise<CallControlResult> {
  try {
    const res = await fetch(controlUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(toVapiControlPayload(action)),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      // A control URL stops working the moment the call ends, which is a race
      // an officer will hit routinely — they click "end call" as the borrower
      // hangs up. Naming it beats a raw 404.
      const ended = res.status === 404 || /not found|ended|completed/i.test(body);
      return {
        ok: false,
        failure: {
          class: ended ? "PERMANENT" : "TRANSIENT",
          message: ended ? "That call has already ended." : `Vapi refused the control request (${res.status}).`,
          affectsAllLeads: false,
        },
      };
    }
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[Vapi control] request failed:", message);
    return {
      ok: false,
      failure: { class: "TRANSIENT", message: `Could not reach the call: ${message}`, affectsAllLeads: false },
    };
  }
}
