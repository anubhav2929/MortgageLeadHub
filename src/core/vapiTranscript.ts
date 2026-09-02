import { redactRestrictedText } from "@/core/sensitiveText";
import type { ConversationTurn } from "@/domain/types";

export interface VapiArtifactMessage {
  role?: string;
  message?: string;
  content?: string | Array<{ type?: string; text?: string }>;
  time?: number;
  secondsFromStart?: number;
}

export type VapiTranscriptArtifact = string | VapiArtifactMessage[];

export interface ReconciledVapiTranscript {
  turns: ConversationTurn[];
  redactionApplied: boolean;
}

export function spokenRoleOf(role: string | undefined): ConversationTurn["role"] | null {
  const normalized = role?.toLowerCase();
  if (normalized === "assistant" || normalized === "bot" || normalized === "ai") return "AGENT";
  if (normalized === "user" || normalized === "customer" || normalized === "borrower") return "BORROWER";
  // System/tool messages are useful in Vapi's diagnostic log but are not
  // spoken conversation and must not appear as borrower claims in the CRM.
  return null;
}

function messageText(message: VapiArtifactMessage): string {
  if (typeof message.message === "string") return message.message.trim();
  if (typeof message.content === "string") return message.content.trim();
  if (Array.isArray(message.content)) {
    return message.content.map((part) => part.text ?? "").filter(Boolean).join(" ").trim();
  }
  return "";
}

function turnTimestamp(startedAt: string, offset: number | undefined, fallbackAt: string): string {
  if (typeof offset !== "number" || !Number.isFinite(offset) || offset < 0) return fallbackAt;
  const start = Date.parse(startedAt);
  return Number.isFinite(start) ? new Date(start + offset * 1000).toISOString() : fallbackAt;
}

/** Convert Vapi's authoritative message history into CRM transcript turns.
 * Provider message indexes are stable within a call and therefore work as
 * durable identities across webhook delivery and API reconciliation. */
export function turnsFromVapiMessages(
  messages: VapiArtifactMessage[] | undefined,
  startedAt: string,
  fallbackAt: string
): ReconciledVapiTranscript {
  const turns: ConversationTurn[] = [];
  let redactionApplied = false;
  for (const [index, message] of (messages ?? []).entries()) {
    const role = spokenRoleOf(message.role);
    const raw = messageText(message);
    if (!role || !raw) continue;
    const sanitized = redactRestrictedText(raw);
    redactionApplied ||= sanitized.redacted;
    turns.push({
      turn: turns.length + 1,
      role,
      text: sanitized.text,
      at: turnTimestamp(startedAt, message.secondsFromStart ?? message.time, fallbackAt),
      providerEventId: `vapi-message:${index}`,
    });
  }
  return { turns, redactionApplied };
}

/** Vapi's fallback transcript is normally speaker-prefixed text. Preserve
 * speaker attribution when artifact.messages is absent instead of storing the
 * entire call as one borrower statement. */
export function turnsFromVapiTranscript(transcript: string | undefined, at: string): ReconciledVapiTranscript {
  const raw = typeof transcript === "string" ? transcript.trim() : "";
  if (!raw) return { turns: [], redactionApplied: false };

  const matches = [...raw.matchAll(/(?:^|\n)\s*(AI|Assistant|Agent|User|Customer|Borrower)\s*:\s*([\s\S]*?)(?=\n\s*(?:AI|Assistant|Agent|User|Customer|Borrower)\s*:|$)/gi)];
  const segments = matches.length > 0
    ? matches.map((match) => ({ role: spokenRoleOf(match[1]), text: match[2] }))
    : [{ role: "BORROWER" as const, text: raw }];
  let redactionApplied = false;
  const turns: ConversationTurn[] = [];
  for (const [index, segment] of segments.entries()) {
    if (!segment.role || !segment.text.trim()) continue;
    const sanitized = redactRestrictedText(segment.text.trim());
    redactionApplied ||= sanitized.redacted;
    turns.push({
      turn: turns.length + 1,
      role: segment.role,
      text: sanitized.text,
      at,
      providerEventId: `vapi-transcript:${index}`,
    });
  }
  return { turns, redactionApplied };
}

/** Prefer the structured final artifact. Fall back to the provider's complete
 * transcript string, and only retain live-event turns when neither exists. */
export function reconcileVapiTranscript(input: {
  current: ConversationTurn[];
  messages?: VapiArtifactMessage[];
  transcript?: VapiTranscriptArtifact;
  startedAt: string;
  at: string;
}): ReconciledVapiTranscript & { authoritative: boolean } {
  const transcriptMessages = Array.isArray(input.transcript) ? input.transcript : undefined;
  const fromMessages = turnsFromVapiMessages(input.messages ?? transcriptMessages, input.startedAt, input.at);
  if (fromMessages.turns.length > 0) return { ...fromMessages, authoritative: true };
  const fromTranscript = turnsFromVapiTranscript(typeof input.transcript === "string" ? input.transcript : undefined, input.at);
  if (fromTranscript.turns.length > 0) return { ...fromTranscript, authoritative: true };
  return { turns: input.current, redactionApplied: false, authoritative: false };
}
