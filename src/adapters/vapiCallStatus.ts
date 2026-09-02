// Reads the provider's own view of a call.
//
// The call board was built entirely on pushed webhooks. That is the right
// primary mechanism — it is immediate and cheap — but it made the provider the
// only source of truth AND the only delivery path for it. When the webhook
// authentication was wrong, every callback 401'd and the board simply believed
// nothing had happened: calls sat on "Calling" until the stale-call reaper
// deleted them, and no transcript ever arrived.
//
// A system whose state is unrecoverable when one HTTP path breaks is fragile
// in a way no amount of careful webhook handling fixes. This is the pull side:
// for a call we think is live but have not heard about recently, ask.

import { getConfigValue } from "@/lib/runtimeConfig";
import type { VapiArtifactMessage } from "@/core/vapiTranscript";

export interface VapiCallState {
  /** queued | ringing | in-progress | forwarding | ended */
  status?: string;
  endedReason?: string;
  startedAt?: string;
  endedAt?: string;
  /** Full transcript, available once the call has ended. */
  transcript?: string;
  recordingUrl?: string;
  /** Per-utterance messages, present on some in-flight calls. */
  messages?: VapiArtifactMessage[];
  recordingAvailable?: boolean;
  callLogAvailable?: boolean;
}

export type VapiCallStateResult =
  | { ok: true; state: VapiCallState }
  /** The provider has no record of this id — it can never resolve. */
  | { ok: false; gone: true }
  /** Transient: network, rate limit, auth. Do not draw conclusions. */
  | { ok: false; gone: false; error: string };

const REQUEST_TIMEOUT_MS = 8000;

export async function fetchVapiCallState(providerCallId: string): Promise<VapiCallStateResult> {
  const key = await getConfigValue("VAPI_API_KEY");
  if (!key) return { ok: false, gone: false, error: "No Vapi API key configured." };

  try {
    const res = await fetch(`https://api.vapi.ai/call/${encodeURIComponent(providerCallId)}`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });

    // 404 is the one response that lets us conclude anything negative: the
    // provider genuinely has no such call, so waiting for it is pointless.
    if (res.status === 404) return { ok: false, gone: true };
    if (!res.ok) return { ok: false, gone: false, error: `Vapi returned ${res.status}` };

    const data = (await res.json()) as {
      status?: string;
      endedReason?: string;
      startedAt?: string;
      endedAt?: string;
      artifact?: {
        transcript?: string;
        recordingUrl?: string;
        recording?: { stereoUrl?: string; combinedUrl?: string; url?: string; mono?: { combinedUrl?: string; assistantUrl?: string; customerUrl?: string } };
        logUrl?: string;
        messages?: VapiCallState["messages"];
      };
      transcript?: string;
      recordingUrl?: string;
      messages?: VapiCallState["messages"];
    };

    return {
      ok: true,
      state: {
        status: data.status,
        endedReason: data.endedReason,
        startedAt: data.startedAt,
        endedAt: data.endedAt,
        transcript: data.artifact?.transcript ?? data.transcript,
        recordingUrl:
          data.artifact?.recording?.stereoUrl ??
          data.artifact?.recording?.combinedUrl ??
          data.artifact?.recording?.url ??
          data.artifact?.recording?.mono?.combinedUrl ??
          data.artifact?.recordingUrl ??
          data.recordingUrl,
        messages: data.artifact?.messages ?? data.messages,
        recordingAvailable: Boolean(data.artifact?.recording || data.artifact?.recordingUrl || data.recordingUrl),
        callLogAvailable: Boolean(data.artifact?.logUrl),
      },
    };
  } catch (err) {
    return { ok: false, gone: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}
