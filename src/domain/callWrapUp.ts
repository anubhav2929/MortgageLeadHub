import { z } from "zod";
import { runAiJson } from "@/adapters/aiGateway";
import type { ConversationSession } from "@/domain/types";

const wrapUpSchema = z.object({
  summary: z.string().min(1).max(3000),
  actionItems: z.array(z.string().min(1).max(300)).max(12),
});

export async function generateCallWrapUp(conversation: ConversationSession): Promise<{
  ok: boolean; summary?: string; actionItems?: string[]; provider?: string; model?: string; error?: string;
}> {
  if (conversation.transcript.length === 0) return { ok: false, error: "No transcript is available" };
  const transcript = conversation.transcript.map((turn) => `[${turn.turn}] ${turn.role}: ${turn.text}`).join("\n");
  const result = await runAiJson({
    operation: "call_wrap_up",
    system:
      "Summarize a mortgage qualification call for a licensed human agent. State only facts in the transcript. " +
      "Do not infer eligibility, approval, rates, legal advice, or financial advice. Action items must be concrete follow-ups.",
    user: `Return {"summary":"...","actionItems":["..."]}.\n\nTranscript:\n${transcript}`,
    maxOutputTokens: 700,
    validate: (value) => wrapUpSchema.parse(value),
  });
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, summary: result.value.summary, actionItems: result.value.actionItems, provider: result.provider, model: result.model };
}
