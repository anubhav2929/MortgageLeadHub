"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { PhoneCall } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Select, Textarea, Label } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { logManualCallAction } from "@/domain/actions";
import type { AttemptOutcome, Channel } from "@/domain/types";

const OUTCOMES: AttemptOutcome[] = ["ANSWERED", "NO_ANSWER", "BUSY", "VOICEMAIL", "DELIVERED", "FAILED"];

export function LogCallButton({ publicRef }: { publicRef: string }) {
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState<Channel>("VOICE");
  const [outcome, setOutcome] = useState<AttemptOutcome>("ANSWERED");
  const [notes, setNotes] = useState("");
  const [isPending, startTransition] = useTransition();
  const { push } = useToast();
  const router = useRouter();

  function submit() {
    startTransition(async () => {
      const result = await logManualCallAction(publicRef, channel, outcome, notes);
      push({ title: result.message, tone: result.ok ? "success" : "danger" });
      if (result.ok) {
        setOpen(false);
        setNotes("");
      }
      router.refresh();
    });
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <PhoneCall className="h-3.5 w-3.5" /> Log a call
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Log a call"
        description="Record contact that happened off-platform (e.g. from a personal phone)."
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" loading={isPending} onClick={submit}>
              Log it
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Channel</Label>
              <Select value={channel} onChange={(e) => setChannel(e.target.value as Channel)}>
                <option value="VOICE">Voice</option>
                <option value="SMS">SMS</option>
                <option value="EMAIL">Email</option>
              </Select>
            </div>
            <div>
              <Label>Outcome</Label>
              <Select value={outcome} onChange={(e) => setOutcome(e.target.value as AttemptOutcome)}>
                {OUTCOMES.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea placeholder="What happened on the call?" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </div>
        </div>
      </Modal>
    </>
  );
}
