"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Sparkles, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Label, Select, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { generateDraftAction, getComposeContextAction, sendSmsComposedAction } from "@/domain/actions";
import { LEAD_STAGE_LABELS, LEAD_STAGE_TEMPLATE_IDS, renderLeadStageTemplate } from "@/core/outreachTemplates";
import type { LeadState, LoanIntent } from "@/domain/types";

interface ComposeContext {
  toName: string;
  intent: LoanIntent;
  officerFirstName: string;
  senderName: string;
  state: LeadState;
}

export function SmsComposeModal({ publicRef, onClose }: { publicRef: string; onClose: () => void }) {
  const [body, setBody] = useState("");
  const [aiBody, setAiBody] = useState("");
  const [ctx, setCtx] = useState<ComposeContext | null>(null);
  const [templateId, setTemplateId] = useState<"ai" | LeadState>("ai");
  const [drafting, setDrafting] = useState(true);
  const [sending, setSending] = useState(false);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const { push } = useToast();
  const router = useRouter();

  useEffect(() => {
    // See EmailComposeModal for why this isn't gated on a "cancelled" flag.
    Promise.all([getComposeContextAction(publicRef), generateDraftAction(publicRef, "SMS")]).then(([context, draft]) => {
      setCtx(context);
      setAiBody(draft.body);
      setTemplateId(context.state);
      setBody(renderLeadStageTemplate({ state: context.state, channel: "SMS", firstName: context.toName, intent: context.intent, officerFirstName: context.officerFirstName, senderName: context.senderName }).body);
      setAiNote(draft.simulated ? "Simulated draft — add an Anthropic or NVIDIA key under Admin → Integrations for a live AI draft." : "AI-drafted — review before sending.");
      setDrafting(false);
    });
  }, [publicRef]);

  function selectTemplate(id: "ai" | LeadState) {
    setTemplateId(id);
    if (id === "ai") return setBody(aiBody);
    if (!ctx) return;
    setBody(renderLeadStageTemplate({ state: id, channel: "SMS", firstName: ctx.toName, intent: ctx.intent, officerFirstName: ctx.officerFirstName, senderName: ctx.senderName }).body);
  }

  function send() {
    setSending(true);
    sendSmsComposedAction(publicRef, body).then((result) => {
      push({ title: result.message, tone: result.ok ? "success" : "danger" });
      setSending(false);
      if (result.ok) onClose();
      router.refresh();
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Compose text"
      description={aiNote ?? undefined}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" loading={sending} disabled={drafting || !body.trim() || (templateId !== "ai" && !!ctx && !renderLeadStageTemplate({ state: templateId, channel: "SMS", firstName: ctx.toName, intent: ctx.intent, officerFirstName: ctx.officerFirstName, senderName: ctx.senderName }).sendable)} onClick={send}>
            <Send className="h-3.5 w-3.5" /> Send
          </Button>
        </>
      }
    >
      {drafting ? (
        <div className="flex items-center gap-2 py-8 text-[13px] text-[var(--muted-foreground)]">
          <Sparkles className="h-4 w-4 animate-pulse text-[var(--primary)]" /> Drafting…
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <Label>Template</Label>
            <Select value={templateId} onChange={(event) => selectTemplate(event.target.value as "ai" | LeadState)}>
              <option value="ai">AI context-aware draft</option>
              {LEAD_STAGE_TEMPLATE_IDS.map((state) => (
                <option key={state} value={state}>{state === ctx?.state ? "Recommended — " : ""}{LEAD_STAGE_LABELS[state]}</option>
              ))}
            </Select>
          </div>
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} maxLength={320} />
          <p className="mt-1.5 text-right text-xs text-[var(--muted-foreground)]">{body.length}/320</p>
        </div>
      )}
    </Modal>
  );
}
