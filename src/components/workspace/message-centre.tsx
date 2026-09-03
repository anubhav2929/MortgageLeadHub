"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Ban, Clock, History, MessageSquare, Search, Send, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { EmptyState } from "@/components/ui/empty-state";
import { generateDraftAction, sendSmsComposedAction } from "@/domain/actions";
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
function Intervene({ thread, providerReady }: { thread: MessageThreadSummary; providerReady: boolean }) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [isPending, startTransition] = useTransition();
  const { push } = useToast();
  const router = useRouter();

  const blockingReason = thread.suppressed
    ? "This number is suppressed — no further texts can be sent."
    : thread.terminal
      ? "This lead is closed or suppressed. Reopen it before sending."
      : !thread.phoneValid
        ? "No valid SMS destination is configured for this lead."
        : thread.smsConsent !== "GRANTED"
          ? thread.smsConsent === "REVOKED" ? "SMS consent was revoked." : "No SMS consent is on file."
          : !providerReady
            ? "Connect and verify Telnyx or Twilio before sending live messages."
            : undefined;

  if (blockingReason) {
    return (
      <p className="mt-2 flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
        <Ban className="h-3.5 w-3.5" /> {blockingReason}
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
      <Button
        size="sm"
        variant="ghost"
        className="mt-1.5"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const draft = await generateDraftAction(thread.leadPublicRef, "SMS");
            setBody(draft.body);
          })
        }
      >
        <Sparkles className="h-3.5 w-3.5" /> Draft from lead context
      </Button>
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

export function MessageCentre({ threads, providerReady }: { threads: MessageThreadSummary[]; providerReady: boolean }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return threads.filter((thread) => {
      if (needle && ![thread.borrowerName, thread.stateCode, thread.maskedPhone, thread.officerName].some((value) => value?.toLowerCase().includes(needle))) return false;
      if (filter === "awaiting") return thread.awaitingUs;
      if (filter === "failed") return Boolean(thread.lastFailure);
      if (filter === "blocked") return thread.suppressed || thread.terminal || !thread.phoneValid || thread.smsConsent !== "GRANTED";
      if (filter === "ready") return providerReady && thread.phoneValid && thread.smsConsent === "GRANTED" && !thread.suppressed && !thread.terminal;
      return true;
    });
  }, [filter, providerReady, query, threads]);

  if (threads.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={MessageSquare}
          title="No text conversations yet"
          description="Leads with SMS destinations and borrower replies appear here."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-[1fr_13rem]">
        <label className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search borrower, state, phone, officer…" className="pl-9" />
        </label>
        <Select value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Filter message conversations">
          <option value="all">All leads ({threads.length})</option>
          <option value="awaiting">Awaiting us</option>
          <option value="ready">Ready to message</option>
          <option value="failed">Delivery failures</option>
          <option value="blocked">Needs setup or consent</option>
        </Select>
      </div>

      {visible.length === 0 && (
        <Card><EmptyState icon={MessageSquare} title="No conversations match" description="Clear the search or choose a different filter." /></Card>
      )}

      {visible.map((t) => (
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
              {!t.suppressed && t.phoneValid && t.smsConsent === "GRANTED" && !t.terminal && <Badge tone="success">Destination ready</Badge>}
              {!t.phoneValid && <Badge tone="danger">Phone needs review</Badge>}
              {t.smsConsent !== "GRANTED" && <Badge tone="warning">{t.smsConsent === "REVOKED" ? "Consent revoked" : "No SMS consent"}</Badge>}
              <span className="text-xs text-[var(--muted-foreground)]">
                {t.maskedPhone} · {t.sentCount} sent
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

            {t.history.length > 0 && (
              <details className="mt-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--background)] px-3 py-2">
                <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-[var(--foreground)]">
                  <History className="h-3.5 w-3.5" /> Conversation history ({t.history.length})
                </summary>
                <div className="mt-3 space-y-2 border-t border-[var(--border)] pt-3">
                  {t.history.map((message) => (
                    <div key={message.id} className={message.direction === "INBOUND" ? "pr-8" : "pl-8 text-right"}>
                      <p className="text-xs text-[var(--muted-foreground)]">
                        {message.sender} · {formatRelative(message.at)}
                        {message.outcome && ` · ${message.outcome.toLowerCase()}`}
                      </p>
                      <p className="mt-0.5 inline-block rounded-[var(--radius-md)] bg-[var(--surface)] px-2.5 py-1.5 text-left text-[13px] text-[var(--foreground)]">
                        {message.body}
                      </p>
                    </div>
                  ))}
                </div>
              </details>
            )}

            <Intervene thread={t} providerReady={providerReady} />
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
