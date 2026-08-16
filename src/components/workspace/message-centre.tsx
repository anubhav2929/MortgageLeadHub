"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Ban, Clock, MessageSquare, Send } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { EmptyState } from "@/components/ui/empty-state";
import { sendSmsComposedAction } from "@/domain/actions";
import { SMS_MAX_CHARS } from "@/core/smsFormat";
import { formatRelative } from "@/lib/utils";
import type { MessageThreadSummary } from "@/domain/queries";

/**
 * Officer intervention, inline on the triage row.
 *
 * The point of this surface is stepping into an automated sequence — seeing
 * that a borrower went quiet after the second follow-up and sending them an
 * actual offer. Making that a five-click trip to the lead page and back is
 * how it stops happening.
 *
 * The send still routes through sendSmsComposedAction, so PolicyGate,
 * suppression, quiet hours, and attempt caps apply exactly as they do
 * anywhere else. This is a shortcut through the UI, never around the rules.
 */
function Intervene({ thread }: { thread: MessageThreadSummary }) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [isPending, startTransition] = useTransition();
  const { push } = useToast();
  const router = useRouter();

  if (thread.suppressed) {
    return (
      <p className="mt-2 flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
        <Ban className="h-3.5 w-3.5" /> This number is suppressed — no further texts can be sent.
      </p>
    );
  }

  if (!open) {
    return (
      <Button size="sm" variant="secondary" className="mt-2" onClick={() => setOpen(true)}>
        <Send className="h-3.5 w-3.5" /> Send a message
      </Button>
    );
  }

  const over = body.length > SMS_MAX_CHARS;

  return (
    <div className="mt-2">
      <Textarea
        rows={3}
        value={body}
        autoFocus
        placeholder="Step in with an offer, an answer, or a nudge…"
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className={`text-xs ${over ? "text-[var(--danger)]" : "text-[var(--muted-foreground)]"}`}>
          {body.length}/{SMS_MAX_CHARS}
          {over && " — will be trimmed"}
        </span>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            loading={isPending}
            disabled={!body.trim()}
            onClick={() =>
              startTransition(async () => {
                const result = await sendSmsComposedAction(thread.leadPublicRef, body.trim());
                push({ title: result.message, tone: result.ok ? "success" : "danger" });
                if (result.ok) {
                  setBody("");
                  setOpen(false);
                  router.refresh();
                }
              })
            }
          >
            <Send className="h-3.5 w-3.5" /> Send
          </Button>
        </div>
      </div>
    </div>
  );
}

export function MessageCentre({ threads }: { threads: MessageThreadSummary[] }) {
  if (threads.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={MessageSquare}
          title="No text conversations yet"
          description="Automated follow-ups and borrower replies appear here as soon as the first text goes out."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {threads.map((t) => (
        <Card
          key={t.leadId}
          className={t.awaitingUs ? "border-[var(--primary)]" : undefined}
        >
          <CardContent className="p-4">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Link
                href={`/workspace/leads/${t.leadPublicRef}`}
                className="text-[14px] font-medium text-[var(--foreground)] hover:text-[var(--primary)]"
              >
                {t.borrowerName}
              </Link>
              {t.stateCode && <Badge tone="neutral">{t.stateCode}</Badge>}
              {/* The only state where a person is actively waiting on us. */}
              {t.awaitingUs && <Badge tone="primary">Replied — needs an answer</Badge>}
              {t.suppressed && <Badge tone="danger">Opted out</Badge>}
              <span className="text-xs text-[var(--muted-foreground)]">
                {t.sentCount} sent
                {t.officerName && ` · ${t.officerName}`}
              </span>
            </div>

            {t.lastOutboundBody && (
              <p className="text-[13px] text-[var(--muted-foreground)]">
                <span className="font-medium text-[var(--foreground)]">Us</span>
                {t.lastOutboundAt && <span className="text-xs"> · {formatRelative(t.lastOutboundAt)}</span>} —{" "}
                {t.lastOutboundBody}
              </p>
            )}
            {t.lastInboundBody && (
              <p className="mt-1 text-[13px] text-[var(--foreground)]">
                <span className="font-medium">{t.borrowerName.split(" ")[0]}</span>
                {t.lastInboundAt && (
                  <span className="text-xs text-[var(--muted-foreground)]"> · {formatRelative(t.lastInboundAt)}</span>
                )}{" "}
                — {t.lastInboundBody}
              </p>
            )}

            {t.lastFailure && (
              <p className="mt-2 flex items-start gap-1.5 text-xs text-[var(--danger)]">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  {t.lastFailure.failureClass && <strong>{t.lastFailure.failureClass}: </strong>}
                  {t.lastFailure.message}
                </span>
              </p>
            )}

            {/* What the automation will do next, so an officer can decide
                whether to let it run or pre-empt it. */}
            {t.nextStepAt && !t.suppressed && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
                <Clock className="h-3.5 w-3.5" />
                Next automated {t.nextStepChannel?.toLowerCase() ?? "touch"} {formatRelative(t.nextStepAt)}
              </p>
            )}

            <Intervene thread={t} />
          </CardContent>
        </Card>
      ))}

      <p className="flex items-center gap-1.5 pt-1 text-xs text-[var(--muted-foreground)]">
        <ArrowRight className="h-3.5 w-3.5" />
        Open a lead for the full conversation across every channel.
      </p>
    </div>
  );
}
