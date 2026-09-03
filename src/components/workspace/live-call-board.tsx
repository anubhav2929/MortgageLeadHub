"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTransition } from "react";
import { Headphones, MicOff, PhoneCall, PhoneForwarded, PhoneOff, Radio, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { controlLiveCallAction, syncCallStateAction } from "@/domain/actions";
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
/**
 * Poll cadence.
 *
 * The board previously stopped polling entirely when empty — an optimisation
 * that broke the primary use case: place a call from a lead, open the board,
 * and nothing ever appeared because an empty board never asked again. It only
 * showed up if you navigated away and back.
 *
 * So it always polls; it just slows down when there is nothing happening.
 */
const POLL_ACTIVE_MS = 2000;
const POLL_IDLE_MS = 3000;

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

/**
 * Live intervention on a connected call.
 *
 * Only ever sends a conversation id. The provider's control URL is a bearer
 * credential — anyone holding it can speak as the company to a borrower — so
 * it stays server-side and is never a prop.
 */
function CallControls({
  conversationId,
  transferTo,
  connected,
}: {
  conversationId: string;
  transferTo?: string;
  /** Speaking, muting and transferring need a connected call; ending does not. */
  connected: boolean;
}) {
  const [say, setSay] = useState("");
  const [isPending, startTransition] = useTransition();
  const { push } = useToast();

  const run = (action: Parameters<typeof controlLiveCallAction>[1], clear = false) =>
    startTransition(async () => {
      const result = await controlLiveCallAction(conversationId, action);
      push({ title: result.message, tone: result.ok ? "success" : "danger" });
      if (result.ok && clear) setSay("");
    });

  return (
    <div className="mt-3 border-t border-[var(--border)] pt-3">
      {!connected && (
        <p className="mb-2 text-xs text-[var(--muted-foreground)]">
          Not connected yet — you can still end this call.
        </p>
      )}
      <div className={`flex flex-wrap items-center gap-2 ${connected ? "" : "hidden"}`}>
        <Input
          value={say}
          onChange={(e) => setSay(e.target.value)}
          placeholder="Have the agent say something…"
          className="min-w-[14rem] flex-1"
          onKeyDown={(e) => {
            if (e.key === "Enter" && say.trim()) run({ type: "SAY", content: say.trim() }, true);
          }}
        />
        <Button
          size="sm"
          variant="secondary"
          loading={isPending}
          disabled={!say.trim()}
          onClick={() => run({ type: "SAY", content: say.trim() }, true)}
        >
          <Send className="h-3.5 w-3.5" /> Say
        </Button>
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        {connected && (
          <Button size="sm" variant="ghost" disabled={isPending} onClick={() => run({ type: "MUTE_AGENT" })}>
            <MicOff className="h-3.5 w-3.5" /> Mute agent
          </Button>
        )}
        {connected && transferTo && (
          <Button
            size="sm"
            variant="ghost"
            disabled={isPending}
            onClick={() =>
              run({
                type: "TRANSFER",
                toNumberE164: transferTo,
                sayFirst: "Let me put you through to a licensed loan officer now.",
              })
            }
          >
            <PhoneForwarded className="h-3.5 w-3.5" /> Transfer to officer
          </Button>
        )}
        <Button size="sm" variant="ghost" disabled={isPending} onClick={() => run({ type: "END_CALL" })}>
          <PhoneOff className="h-3.5 w-3.5 text-[var(--danger)]" /> End call
        </Button>
      </div>
      {connected && (
        <p className="mt-1.5 text-xs text-[var(--muted-foreground)]">
          Anything you send here is spoken to the borrower and recorded against your name.
        </p>
      )}
    </div>
  );
}

export function LiveCallBoard({ calls }: { calls: CallCentreEntry[] }) {
  const router = useRouter();
  const [now, setNow] = useState(() => Date.now());

  const hasCalls = calls.length > 0;

  useEffect(() => {
    let tick: ReturnType<typeof setInterval> | undefined;
    let poll: ReturnType<typeof setInterval> | undefined;

    const stop = () => {
      if (tick) clearInterval(tick);
      if (poll) clearInterval(poll);
      tick = undefined;
      poll = undefined;
    };

    // Guards against overlap. A poll that takes longer than the interval —
    // which is exactly what happens under load — would otherwise stack, and
    // several refreshes landing together is what made the board flash.
    let busy = false;
    let cancelled = false;

    const cycle = async () => {
      if (busy || document.hidden) return;
      busy = true;
      try {
        // Explicit sync, then read. The read itself is pure; this is the only
        // thing that advances state, and concurrent callers join one pass.
        await syncCallStateAction();
        if (!cancelled) router.refresh();
      } catch {
        // Never surface this. A failed sync means slightly stale data, which
        // is strictly better than an error boundary blanking a live call.
      } finally {
        busy = false;
      }
    };

    const start = () => {
      if (tick) return; // already running
      tick = setInterval(() => setNow(Date.now()), 1000);
      poll = setInterval(cycle, hasCalls ? POLL_ACTIVE_MS : POLL_IDLE_MS);
    };

    // Polling pauses while the tab is in the background and resumes on
    // return, with an immediate refresh so the operator never reads a stale
    // board for up to a full interval.
    //
    // This is not only about saving requests. Browsers throttle timers in
    // hidden tabs and then fire the backlog on focus, so an unguarded poll
    // produces a burst of refreshes the moment someone switches back — which
    // is exactly when they are trying to read the screen. The elapsed timer
    // recomputes from a timestamp rather than counting ticks, so pausing it
    // costs nothing: it shows the correct duration immediately on return.
    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        setNow(Date.now());
        void cycle();
        start();
      }
    };

    if (!document.hidden) {
      // Sync immediately on mount so opening the board never shows a stale
      // snapshot for a full interval.
      void cycle();
      start();
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [hasCalls, router]);

  if (calls.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={PhoneCall}
          title="No calls in progress"
          description="Watching for calls — this updates on its own. Place one from a lead and it appears here within a few seconds, with the transcript filling in as it is spoken."
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
                  href={`/workspace/leads/${c.leadPublicRef}?tab=conversation`}
                  className="text-[14px] font-medium text-[var(--foreground)] hover:text-[var(--primary)]"
                >
                  {c.borrowerName}
                </Link>
                {c.stateCode && <Badge tone="neutral">{c.stateCode}</Badge>}
                <Badge tone="neutral">{elapsed(convo.startedAt, now)}</Badge>
                {c.officerName && (
                  <span className="text-xs text-[var(--muted-foreground)]">assigned to {c.officerName}</span>
                )}
                {convo.hasAudioStream && (
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

              {/* Available on any call that has not ended — including one
                  stuck on "Calling", which is precisely when an officer most
                  needs a way to kill it. Speak/mute/transfer only make sense
                  once connected, so those are hidden until then; End call is
                  always offered. */}
              {convo.callStatus !== "ENDED" && convo.hasControl && (
                <CallControls
                  conversationId={convo.id}
                  transferTo={c.officerPhone}
                  connected={convo.callStatus === "CONNECTED"}
                />
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
