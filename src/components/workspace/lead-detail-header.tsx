"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowLeft, Phone, MessageSquare, Mail, ThumbsUp, ThumbsDown, ShieldQuestion, UserCog, Bot } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/input";
import { ActionButton } from "@/components/workspace/action-button";
import { LogCallButton } from "@/components/workspace/log-call-button";
import { DialerModal } from "@/components/workspace/dialer-modal";
import { EmailComposeModal } from "@/components/workspace/email-compose-modal";
import { SmsComposeModal } from "@/components/workspace/sms-compose-modal";
import { useToast } from "@/components/ui/toast";
import { STATE_LABELS, STATE_TONE } from "@/core/stateMachine";
import {
  acknowledgeAssignmentAction,
  markWonLostAction,
  requestComplianceReviewAction,
  startVoiceAgentCallAction,
  takeOverLeadAction,
} from "@/domain/actions";
import type { Lead } from "@/domain/types";

export function LeadDetailHeader({
  lead,
  fullName,
  canTakeOver,
  canCallNow,
  canMarkWonLost,
  canAcknowledge,
  assignedOfficerName,
}: {
  lead: Lead;
  fullName: string;
  canTakeOver: boolean;
  canCallNow: boolean;
  canMarkWonLost: boolean;
  canAcknowledge: boolean;
  assignedOfficerName?: string;
}) {
  const [closeModal, setCloseModal] = useState<"WON" | "LOST" | null>(null);
  const [reviewModal, setReviewModal] = useState(false);
  const [takeOverModal, setTakeOverModal] = useState(false);
  const [dialerOpen, setDialerOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [smsOpen, setSmsOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [isPending, startTransition] = useTransition();
  const { push } = useToast();
  const router = useRouter();

  const isTerminal = ["SUPPRESSED", "CLOSED_WON", "CLOSED_LOST"].includes(lead.state);

  function submitTakeOver() {
    startTransition(async () => {
      const result = await takeOverLeadAction(lead.publicRef);
      push({ title: result.message, tone: result.ok ? "success" : "danger" });
      setTakeOverModal(false);
      router.refresh();
    });
  }

  function submitClose() {
    if (!closeModal) return;
    startTransition(async () => {
      const result = await markWonLostAction(lead.publicRef, closeModal, reason);
      push({ title: result.ok ? result.message : "Blocked", description: result.ok ? undefined : result.message, tone: result.ok ? "success" : "danger" });
      setCloseModal(null);
      setReason("");
      router.refresh();
    });
  }

  function submitReview() {
    startTransition(async () => {
      const result = await requestComplianceReviewAction(lead.publicRef, reason);
      push({ title: result.message, tone: result.ok ? "success" : "danger" });
      setReviewModal(false);
      setReason("");
      router.refresh();
    });
  }

  return (
    <div className="mb-6">
      <Link
        href="/workspace/leads"
        className="mb-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        All leads
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-semibold tracking-tight text-[var(--foreground)]">{fullName}</h1>
            <Badge tone={STATE_TONE[lead.state]}>{STATE_LABELS[lead.state]}</Badge>
          </div>
          <p className="mt-1 text-[13px] text-[var(--muted-foreground)]">
            {lead.intent.replace("_", " ")} · {lead.city}, {lead.stateCode} · ref {lead.publicRef}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canAcknowledge && (
            <ActionButton action={() => acknowledgeAssignmentAction(lead.publicRef)} variant="primary" size="sm">
              <UserCog className="h-3.5 w-3.5" /> Acknowledge handoff
            </ActionButton>
          )}
          {canTakeOver && !isTerminal && (
            <Button variant="secondary" size="sm" onClick={() => setTakeOverModal(true)}>
              <UserCog className="h-3.5 w-3.5" /> Take over
            </Button>
          )}
          {canCallNow && !isTerminal && (
            <div className="flex items-center gap-1 rounded-[var(--radius-md)] border border-[var(--border-strong)] bg-[var(--surface)] p-0.5">
              <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setDialerOpen(true)}>
                <Phone className="h-3.5 w-3.5" /> Call
              </Button>
              <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setSmsOpen(true)}>
                <MessageSquare className="h-3.5 w-3.5" /> Text
              </Button>
              <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setEmailOpen(true)}>
                <Mail className="h-3.5 w-3.5" /> Email
              </Button>
              <ActionButton
                action={() => startVoiceAgentCallAction(lead.publicRef)}
                variant="ghost"
                size="sm"
                className="h-7 px-2"
              >
                <Bot className="h-3.5 w-3.5" /> AI call
              </ActionButton>
            </div>
          )}
          {canMarkWonLost && lead.state === "ACKNOWLEDGED" && (
            <>
              <Button variant="secondary" size="sm" onClick={() => setCloseModal("WON")}>
                <ThumbsUp className="h-3.5 w-3.5" /> Mark won
              </Button>
              <Button variant="outlineDanger" size="sm" onClick={() => setCloseModal("LOST")}>
                <ThumbsDown className="h-3.5 w-3.5" /> Mark lost
              </Button>
            </>
          )}
          {canCallNow && <LogCallButton publicRef={lead.publicRef} />}
          <Button variant="ghost" size="sm" onClick={() => setReviewModal(true)}>
            <ShieldQuestion className="h-3.5 w-3.5" /> Request compliance review
          </Button>
        </div>
      </div>

      {!canCallNow && canTakeOver && !isTerminal && (
        <p className="mt-2 text-xs text-[var(--muted-foreground)]">
          {assignedOfficerName
            ? `Assigned to ${assignedOfficerName} — take over to call, text, or email this lead yourself.`
            : "This lead isn't assigned to anyone yet — take over to call, text, or email it."}
        </p>
      )}

      <Modal
        open={closeModal !== null}
        onClose={() => setCloseModal(null)}
        title={closeModal === "WON" ? "Mark lead as won" : "Mark lead as lost"}
        description="This closes the lead permanently. Add a short reason for the record."
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setCloseModal(null)}>
              Cancel
            </Button>
            <Button
              variant={closeModal === "LOST" ? "danger" : "primary"}
              size="sm"
              loading={isPending}
              onClick={submitClose}
            >
              Confirm
            </Button>
          </>
        }
      >
        <Textarea
          placeholder="Reason (optional)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
        />
      </Modal>

      <Modal
        open={reviewModal}
        onClose={() => setReviewModal(false)}
        title="Request compliance review"
        description="Creates an urgent compliance task and pauses further automation review."
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setReviewModal(false)}>
              Cancel
            </Button>
            <Button size="sm" loading={isPending} onClick={submitReview}>
              Submit
            </Button>
          </>
        }
      >
        <Textarea
          placeholder="What should compliance look at?"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
        />
      </Modal>

      <Modal
        open={takeOverModal}
        onClose={() => setTakeOverModal(false)}
        title="Take over this lead?"
        description={
          assignedOfficerName
            ? `This lead is currently assigned to ${assignedOfficerName}. Taking over reassigns it to you and they'll lose ownership.`
            : "This assigns the lead to you."
        }
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setTakeOverModal(false)}>
              Cancel
            </Button>
            <Button size="sm" loading={isPending} onClick={submitTakeOver}>
              Take over
            </Button>
          </>
        }
      />

      {dialerOpen && <DialerModal publicRef={lead.publicRef} fullName={fullName} onClose={() => setDialerOpen(false)} />}
      {emailOpen && <EmailComposeModal publicRef={lead.publicRef} onClose={() => setEmailOpen(false)} />}
      {smsOpen && <SmsComposeModal publicRef={lead.publicRef} onClose={() => setSmsOpen(false)} />}
    </div>
  );
}
