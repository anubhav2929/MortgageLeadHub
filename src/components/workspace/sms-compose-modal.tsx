"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Sparkles, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { generateDraftAction, sendSmsComposedAction } from "@/domain/actions";

export function SmsComposeModal({ publicRef, onClose }: { publicRef: string; onClose: () => void }) {
  const [body, setBody] = useState("");
  const [drafting, setDrafting] = useState(true);
  const [sending, setSending] = useState(false);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const { push } = useToast();
  const router = useRouter();

  useEffect(() => {
    // See EmailComposeModal for why this isn't gated on a "cancelled" flag.
    generateDraftAction(publicRef, "SMS").then((draft) => {
      setBody(draft.body);
      setAiNote(draft.simulated ? "Simulated draft — set ANTHROPIC_API_KEY for a live AI draft." : "Drafted by Claude — review before sending.");
      setDrafting(false);
    });
  }, [publicRef]);

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
          <Button size="sm" loading={sending} disabled={drafting || !body.trim()} onClick={send}>
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
        <div>
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} maxLength={320} />
          <p className="mt-1.5 text-right text-xs text-[var(--muted-foreground)]">{body.length}/320</p>
        </div>
      )}
    </Modal>
  );
}
