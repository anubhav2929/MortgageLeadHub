"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { MessageSquareText, Sparkles, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { dismissSignalAction, generateSignalReplyAction, promoteSignalToLeadAction } from "@/domain/actions";

export function SignalActions({ signalId, canPromote }: { signalId: string; canPromote: boolean }) {
  const [dismissOpen, setDismissOpen] = useState(false);
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyDraft, setReplyDraft] = useState("");
  const [replyLoading, setReplyLoading] = useState(false);
  const [replySimulated, setReplySimulated] = useState(false);
  const [copied, setCopied] = useState(false);
  const [note, setNote] = useState("");
  const [isPending, startTransition] = useTransition();
  const { push } = useToast();
  const router = useRouter();

  function openReply() {
    setReplyOpen(true);
    setCopied(false);
    setReplyLoading(true);
    generateSignalReplyAction(signalId).then((draft) => {
      setReplyDraft(draft.body);
      setReplySimulated(draft.simulated);
      setReplyLoading(false);
    });
  }

  function copyReply() {
    navigator.clipboard.writeText(replyDraft).then(() => setCopied(true));
  }

  function dismiss() {
    startTransition(async () => {
      const result = await dismissSignalAction(signalId, note);
      push({ title: result.message, tone: result.ok ? "success" : "danger" });
      setDismissOpen(false);
      router.refresh();
    });
  }

  function promote() {
    startTransition(async () => {
      const result = await promoteSignalToLeadAction(signalId);
      push({ title: result.message, tone: result.ok ? "success" : "danger" });
      setPromoteOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={openReply}>
          <MessageSquareText className="h-3.5 w-3.5" /> Draft reply
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setDismissOpen(true)}>
          <X className="h-3.5 w-3.5" /> Dismiss
        </Button>
        {canPromote && (
          <Button variant="secondary" size="sm" onClick={() => setPromoteOpen(true)}>
            <UserPlus className="h-3.5 w-3.5" /> Add to CRM
          </Button>
        )}
      </div>

      <Modal
        open={dismissOpen}
        onClose={() => setDismissOpen(false)}
        title="Dismiss signal"
        description="Marks this post as reviewed and not worth pursuing."
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setDismissOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" loading={isPending} onClick={dismiss}>
              Dismiss
            </Button>
          </>
        }
      >
        <Textarea placeholder="Why? (optional)" value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
      </Modal>

      <Modal
        open={promoteOpen}
        onClose={() => setPromoteOpen(false)}
        title="Add to CRM"
        description="Creates a lead record with no consent on file. PolicyGate will deny every automated call, text, or email to this person until real, documented consent exists — this only creates a tracking record, it does not authorize contact."
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setPromoteOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" loading={isPending} onClick={promote}>
              Add with no consent on file
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-[var(--muted-foreground)]">
          Only do this if you have, or intend to independently obtain, this person&apos;s real consent to be
          contacted through a legitimate channel.
        </p>
      </Modal>

      <Modal
        open={replyOpen}
        onClose={() => setReplyOpen(false)}
        title="Draft reply"
        description="A draft for a human to review and post from the company's own account — nothing here posts automatically."
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setReplyOpen(false)}>
              Close
            </Button>
            <Button size="sm" onClick={copyReply} disabled={replyLoading || !replyDraft}>
              {copied ? "Copied" : "Copy"}
            </Button>
          </>
        }
      >
        {replyLoading ? (
          <div className="flex items-center gap-2 py-6 text-[13px] text-[var(--muted-foreground)]">
            <Sparkles className="h-4 w-4 animate-pulse text-[var(--primary)]" /> Drafting…
          </div>
        ) : (
          <div>
            <Textarea value={replyDraft} onChange={(e) => setReplyDraft(e.target.value)} rows={6} />
            <p className="mt-1.5 text-xs text-[var(--muted-foreground)]">
              {replySimulated ? "Simulated draft — set ANTHROPIC_API_KEY for a live AI draft." : "Drafted by Claude — review before posting."}
            </p>
          </div>
        )}
      </Modal>
    </>
  );
}
