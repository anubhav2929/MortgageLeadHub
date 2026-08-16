"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Headphones, PhoneCall, Radio } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import type { CallCentreEntry } from "@/domain/queries";

/**
 * Calls in progress, with the transcript filling in as it is spoken.
 *
 * The transcript arrives through the provider's per-utterance webhook
 * (app/api/webhooks/vapi), which appends to the session as the call happens.
 * That data was already being stored — it simply had no screen, so nobody
 * could watch a call unless they opened the lead afterwards and read it cold.
 *
 * Refreshed by polling rather than a socket. The data path is
 * provider → webhook → store → server component, so a socket here would only
 * shorten the last hop of four, and it would add a connection to hold open
 * per viewer for a board that is empty most of the day. Polling stops
 * entirely when nothing is live.
 */
const POLL_MS = 4000;

/**
 * What to show for each stage of the call.
 *
 * The board previously rendered a hardcoded "LIVE" for every session, because
 * the session was created as IN_PROGRESS at dial time. A queued call, a
 * ringing call, and a call nobody answered all looked identical to a live
 * conversation — and one that never connected stayed on the board forever
 * claiming to be connected.
 */
const STAGE = {
  QUEUED: { label: "Calling", tone: "text-[var(--muted-foreground)]", pulse: false, placeholder: "Placing the call…" },
  RINGING: { label: "Ringing", tone: "text-[var(--warning)]", pulse: true, placeholder: "Ringing — nobody has picked up yet." },
  CONNECTED: { label: "LIVE", tone: "text-[var(--success)]", pulse: true, placeholder: "Connected — waiting for the first words." },
  ENDED: { label: "Ended", tone: "text-[var(--muted-foreground)]", pulse: false, placeholder: "Call ended." },
} as const;

function elapsed(startedAt: string, now: number): string {
  const secs = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
}

export function LiveCallBoard({ calls }: { calls: CallCentreEntry[] }) {
  const router = useRouter();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    // Nothing live means nothing to poll for. A board that keeps hitting the
    // server all night to render "no calls" is pure cost.
    if (calls.length === 0) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(() => router.refresh(), POLL_MS);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [calls.length, router]);

  if (calls.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={PhoneCall}
          title="No calls in progress"
          description="Live calls appear here the moment the agent connects, with the transcript filling in as it is spoken."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {calls.map((c) => {
        const convo = c.conversation!;
        const turns = convo.transcript;
        const stage = STAGE[convo.callStatus ?? "QUEUED"];
        return (
          <Card
            key={convo.id}
            className={convo.callStatus === "CONNECTED" ? "border-[var(--success)]" : undefined}
          >
            <CardContent className="p-4">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className={`flex items-center gap-1.5 text-[13px] font-semibold ${stage.tone}`}>
                  <Radio className={`h-3.5 w-3.5 ${stage.pulse ? "animate-pulse" : ""}`} /> {stage.label}
                </span>
                <Link
                  href={`/workspace/leads/${c.leadPublicRef}`}
                  className="text-[14px] font-medium text-[var(--foreground)] hover:text-[var(--primary)]"
                >
                  {c.borrowerName}
                </Link>
                {c.stateCode && <Badge tone="neutral">{c.stateCode}</Badge>}
                <Badge tone="neutral">{elapsed(convo.startedAt, now)}</Badge>
                {c.officerName && (
                  <span className="text-xs text-[var(--muted-foreground)]">assigned to {c.officerName}</span>
                )}
                {convo.listenUrl && (
                  <span className="ml-auto flex items-center gap-1 text-xs text-[var(--muted-foreground)]">
                    <Headphones className="h-3.5 w-3.5" /> audio stream available
                  </span>
                )}
              </div>

              <div className="max-h-72 space-y-2 overflow-y-auto rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--background)] p-3">
                {turns.length === 0 ? (
                  <p className="text-[13px] italic text-[var(--muted-foreground)]">{stage.placeholder}</p>
                ) : (
                  turns.map((t) => (
                    <div key={t.turn} className={t.role === "BORROWER" ? "text-left" : "text-left"}>
                      <span
                        className={`mr-1.5 text-xs font-semibold ${
                          t.role === "BORROWER" ? "text-[var(--primary)]" : "text-[var(--muted-foreground)]"
                        }`}
                      >
                        {t.role === "BORROWER" ? c.borrowerName.split(" ")[0] : "Agent"}:
                      </span>
                      <span className="text-[13px] text-[var(--foreground)]">{t.text}</span>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
