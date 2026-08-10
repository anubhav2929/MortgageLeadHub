"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PhoneIncoming, PhoneOutgoing, Copy, Check, Bot, Loader2, Wrench } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { startDialerCallAction } from "@/domain/actions";
import { formatDateTime } from "@/lib/utils";
import type { ContactAttempt } from "@/domain/types";

/** Formats +12132892042 → +1 (213) 289 2042 for display only. */
function prettyPhone(e164: string): string {
  const digits = e164.replace(/[^\d]/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)} ${digits.slice(7)}`;
  }
  return e164;
}

const OUTCOME_TONE: Record<string, "success" | "warning" | "danger" | "neutral"> = {
  ANSWERED: "success",
  DELIVERED: "success",
  NO_ANSWER: "warning",
  BUSY: "warning",
  VOICEMAIL: "warning",
  QUEUED: "neutral",
  SENT: "neutral",
  FAILED: "danger",
  UNDELIVERED: "danger",
  BLOCKED: "danger",
};

export function CallsTab({
  publicRef,
  borrowerName,
  borrowerPhone,
  inboundNumber,
  outboundReady,
  outboundNote,
  calls,
}: {
  publicRef: string;
  borrowerName: string;
  borrowerPhone: string;
  /** The line borrowers dial in on. Null when no inbound number is configured. */
  inboundNumber: string | null;
  /** True once a conversational voice agent is fully configured. */
  outboundReady: boolean;
  /** Why outbound isn't ready, when it isn't. */
  outboundNote: string;
  calls: ContactAttempt[];
}) {
  const [copied, setCopied] = useState(false);
  const [dialing, setDialing] = useState(false);
  const { push } = useToast();
  const router = useRouter();

  function copyInbound() {
    if (!inboundNumber) return;
    navigator.clipboard.writeText(inboundNumber);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  function callNow() {
    setDialing(true);
    startDialerCallAction(publicRef).then((result) => {
      push({ title: result.message, tone: result.ok ? "success" : "danger" });
      setDialing(false);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {/* ---------------- Inbound ---------------- */}
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-2">
              <div>
                <CardTitle className="flex items-center gap-1.5">
                  <PhoneIncoming className="h-3.5 w-3.5" /> Inbound call
                </CardTitle>
                <CardDescription>The line {borrowerName.split(" ")[0]} reaches you on.</CardDescription>
              </div>
              <Badge tone={inboundNumber ? "success" : "neutral"}>{inboundNumber ? "Live" : "Not set"}</Badge>
            </div>
          </CardHeader>
          <CardContent>
            {inboundNumber ? (
              <>
                <div className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--background)] px-3.5 py-3">
                  <a
                    href={`tel:${inboundNumber}`}
                    className="mkt-mono text-[17px] font-semibold tracking-tight text-[var(--foreground)] hover:text-[var(--primary)]"
                  >
                    {prettyPhone(inboundNumber)}
                  </a>
                  <Button variant="ghost" size="sm" onClick={copyInbound} aria-label="Copy inbound number">
                    {copied ? <Check className="h-3.5 w-3.5 text-[var(--success)]" /> : <Copy className="h-3.5 w-3.5" />}
                  </Button>
                </div>
                <p className="mt-2.5 text-xs leading-relaxed text-[var(--muted-foreground)]">
                  Give this number to the borrower, or expect their callback here. Inbound calls are not yet matched to
                  this lead automatically — log the outcome with <strong>Log a call</strong> after it ends.
                </p>
              </>
            ) : (
              <p className="text-[13px] text-[var(--muted-foreground)]">
                No inbound number configured. Add one under <strong>Admin → Integrations → Platform</strong>.
              </p>
            )}
          </CardContent>
        </Card>

        {/* ---------------- Outbound ---------------- */}
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-2">
              <div>
                <CardTitle className="flex items-center gap-1.5">
                  <PhoneOutgoing className="h-3.5 w-3.5" /> Outbound call
                </CardTitle>
                <CardDescription>AI agent calls {prettyPhone(borrowerPhone)}.</CardDescription>
              </div>
              <Badge tone={outboundReady ? "success" : "warning"}>
                {outboundReady ? "Ready" : "Configuring"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            {outboundReady ? (
              <>
                <Button className="w-full" size="sm" loading={dialing} onClick={callNow}>
                  {dialing ? <Loader2 className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
                  Call this lead now
                </Button>
                <p className="mt-2.5 text-xs leading-relaxed text-[var(--muted-foreground)]">
                  The agent picks up the conversation where your texts and emails left off, and the transcript lands on
                  this lead automatically when the call ends.
                </p>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--warning)] bg-[var(--warning-tint)] px-3.5 py-3">
                  <Wrench className="h-4 w-4 shrink-0 text-[var(--warning)]" />
                  <span className="text-[13px] font-medium text-[var(--foreground)]">Configuring…</span>
                </div>
                <p className="mt-2.5 text-xs leading-relaxed text-[var(--muted-foreground)]">{outboundNote}</p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ---------------- History ---------------- */}
      <Card>
        <CardHeader>
          <CardTitle>Call history</CardTitle>
          <CardDescription>
            {calls.length === 0
              ? "No calls yet."
              : `${calls.length} call${calls.length === 1 ? "" : "s"} on this lead.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {calls.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-[var(--muted-foreground)]">
              Calls placed from here — or logged manually — appear in this list.
            </p>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {calls.map((call) => (
                <li key={call.id} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-[13px] font-medium text-[var(--foreground)]">
                      {call.direction === "INBOUND" ? (
                        <PhoneIncoming className="h-3 w-3 text-[var(--muted-foreground)]" />
                      ) : (
                        <PhoneOutgoing className="h-3 w-3 text-[var(--muted-foreground)]" />
                      )}
                      {call.direction === "INBOUND" ? "Inbound" : "Outbound"}
                      {call.durationSec ? (
                        <span className="mkt-mono text-xs font-normal text-[var(--muted-foreground)]">
                          {Math.floor(call.durationSec / 60)}m {call.durationSec % 60}s
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                      {formatDateTime(call.startedAt ?? call.scheduledFor)}
                      {call.loggedByName ? ` · logged by ${call.loggedByName}` : ""}
                    </p>
                    {call.failureMessage && (
                      <p className="mt-1 text-xs text-[var(--danger)]">{call.failureMessage}</p>
                    )}
                  </div>
                  <Badge tone={OUTCOME_TONE[call.outcome] ?? "neutral"}>{call.outcome.replace("_", " ")}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
