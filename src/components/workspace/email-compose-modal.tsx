"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Sparkles, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { generateDraftAction, getComposeContextAction, sendEmailAction } from "@/domain/actions";
import { LEAD_STAGE_LABELS, LEAD_STAGE_TEMPLATE_IDS, renderLeadStageTemplate } from "@/core/outreachTemplates";
import type { LeadState, LoanIntent } from "@/domain/types";

type Mode = "template" | "custom";
type TemplateId = "ai" | LeadState;

interface Draft {
  subject: string;
  body: string;
}

interface ComposeContext {
  toEmail: string;
  toName: string;
  intent: LoanIntent;
  officerFirstName: string;
  senderName: string;
  senderEmail: string;
  state: LeadState;
}

function stageTemplate(id: LeadState, ctx: ComposeContext): Draft {
  const template = renderLeadStageTemplate({
    state: id,
    channel: "EMAIL",
    firstName: ctx.toName,
    intent: ctx.intent,
    officerFirstName: ctx.officerFirstName,
    senderName: ctx.senderName,
  });
  return { subject: template.subject ?? "Following up on your inquiry", body: template.body };
}

/** Mounted only while open (parent conditionally renders) so each open is a
 *  fresh instance — no effect-driven state reset needed. */
export function EmailComposeModal({ publicRef, onClose }: { publicRef: string; onClose: () => void }) {
  const [ctx, setCtx] = useState<ComposeContext | null>(null);
  const [toEmail, setToEmail] = useState("");
  const [mode, setMode] = useState<Mode>("template");
  const [templateId, setTemplateId] = useState<TemplateId>("ai");
  const [aiDraft, setAiDraft] = useState<Draft>({ subject: "", body: "" });
  const [draft, setDraft] = useState<Draft>({ subject: "", body: "" });
  const [customDraft, setCustomDraft] = useState<Draft>({ subject: "", body: "" });
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [aiSimulated, setAiSimulated] = useState(false);
  const { push } = useToast();
  const router = useRouter();

  useEffect(() => {
    // Not gated on a "cancelled" flag: with React StrictMode's dev-mode
    // synthetic mount→cleanup→mount cycle, a closure-local cancelled flag
    // gets flipped by the first cleanup and silently discards the real
    // result. These calls are read-only (no side effect to dedupe), so it's
    // safe to just let them resolve normally.
    Promise.all([getComposeContextAction(publicRef), generateDraftAction(publicRef, "EMAIL")]).then(([context, draftResult]) => {
      const initial = { subject: draftResult.subject ?? "Following up on your inquiry", body: draftResult.body };
      setCtx(context);
      setTemplateId(context.state);
      setToEmail(context.toEmail);
      setAiDraft(initial);
      setDraft(stageTemplate(context.state, context));
      setAiSimulated(draftResult.simulated);
      setLoading(false);
    });
  }, [publicRef]);

  function selectMode(next: Mode) {
    setMode(next);
    if (next === "custom") {
      setDraft(customDraft);
    } else {
      setDraft(templateId === "ai" ? aiDraft : ctx ? stageTemplate(templateId, ctx) : aiDraft);
    }
  }

  function selectTemplate(id: TemplateId) {
    setTemplateId(id);
    setDraft(id === "ai" ? aiDraft : ctx ? stageTemplate(id, ctx) : aiDraft);
  }

  function updateDraft(field: "subject" | "body", value: string) {
    const next = { ...draft, [field]: value };
    setDraft(next);
    if (mode === "custom") setCustomDraft(next);
  }

  function send() {
    setSending(true);
    sendEmailAction(publicRef, draft.subject, draft.body, toEmail).then((result) => {
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
      title="Compose email"
      description={ctx ? `From ${ctx.senderName} <${ctx.senderEmail}>` : undefined}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" loading={sending} disabled={loading || !toEmail.includes("@") || !draft.body.trim() || !draft.subject.trim() || (templateId !== "ai" && !renderLeadStageTemplate({ state: templateId, channel: "EMAIL", firstName: ctx?.toName ?? "there", intent: ctx?.intent ?? "UNKNOWN", officerFirstName: ctx?.officerFirstName ?? "Officer", senderName: ctx?.senderName ?? "Equity Flow Group" }).sendable)} onClick={send}>
            <Send className="h-3.5 w-3.5" /> Send
          </Button>
        </>
      }
    >
      {loading ? (
        <div className="flex items-center gap-2 py-8 text-[13px] text-[var(--muted-foreground)]">
          <Sparkles className="h-4 w-4 animate-pulse text-[var(--primary)]" /> Loading…
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <Label>To</Label>
            <Input type="email" value={toEmail} onChange={(e) => setToEmail(e.target.value)} placeholder="customer@example.com" />
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">Confirm this is the right address before sending — it&apos;s on file for this lead.</p>
          </div>

          <div className="flex items-center gap-1 rounded-[var(--radius-md)] border border-[var(--border-strong)] bg-[var(--background)] p-0.5">
            {(["template", "custom"] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => selectMode(m)}
                className={`flex-1 rounded-[calc(var(--radius-md)-2px)] py-1.5 text-[12px] font-medium capitalize transition-colors ${
                  mode === m ? "bg-[var(--surface)] text-[var(--foreground)] shadow-[var(--shadow-sm)]" : "text-[var(--muted-foreground)]"
                }`}
              >
                {m === "template" ? "Template" : "Custom"}
              </button>
            ))}
          </div>

          {mode === "template" && (
            <div>
              <Label>Template</Label>
              <Select value={templateId} onChange={(e) => selectTemplate(e.target.value as TemplateId)}>
                <option value="ai">{aiSimulated ? "AI draft (simulated)" : "AI draft"}</option>
                {LEAD_STAGE_TEMPLATE_IDS.map((state) => (
                  <option key={state} value={state}>{state === ctx?.state ? "Recommended — " : ""}{LEAD_STAGE_LABELS[state]}</option>
                ))}
              </Select>
            </div>
          )}

          <div>
            <Label>Subject</Label>
            <Input value={draft.subject} onChange={(e) => updateDraft("subject", e.target.value)} />
          </div>
          <div>
            <Label>Body</Label>
            <Textarea value={draft.body} onChange={(e) => updateDraft("body", e.target.value)} rows={8} />
          </div>
        </div>
      )}
    </Modal>
  );
}
