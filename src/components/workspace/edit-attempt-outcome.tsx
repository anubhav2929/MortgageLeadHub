"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Select, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { editAttemptOutcomeAction } from "@/domain/actions";
import type { AttemptOutcome } from "@/domain/types";

const OUTCOMES: AttemptOutcome[] = [
  "QUEUED",
  "SENT",
  "DELIVERED",
  "ANSWERED",
  "NO_ANSWER",
  "BUSY",
  "VOICEMAIL",
  "FAILED",
  "BLOCKED",
  "UNDELIVERED",
];

export function EditAttemptOutcome({ publicRef, attemptId, currentOutcome }: { publicRef: string; attemptId: string; currentOutcome: AttemptOutcome }) {
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<AttemptOutcome>(currentOutcome);
  const [notes, setNotes] = useState("");
  const [isPending, startTransition] = useTransition();
  const { push } = useToast();
  const router = useRouter();

  function submit() {
    startTransition(async () => {
      const result = await editAttemptOutcomeAction(publicRef, attemptId, outcome, notes);
      push({ title: result.message, tone: result.ok ? "success" : "danger" });
      if (result.ok) setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="focus-ring rounded p-1 text-[var(--muted-foreground)] hover:bg-[var(--background)] hover:text-[var(--foreground)]"
        title="Edit outcome"
      >
        <Pencil className="h-3 w-3" />
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Edit call log outcome"
        description="Corrects the record — the change is logged as a FIELD_CORRECTED event."
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" loading={isPending} onClick={submit}>
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Select value={outcome} onChange={(e) => setOutcome(e.target.value as AttemptOutcome)}>
            {OUTCOMES.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </Select>
          <Textarea placeholder="Why is this being corrected? (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
        </div>
      </Modal>
    </>
  );
}
