"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp, PhoneCall, Radio } from "lucide-react";
import type { LiveCallSummary } from "@/app/api/calls/live/route";

/**
 * Live calls, visible from anywhere in the workspace.
 *
 * Mounted in the workspace layout so an officer who navigates to a lead, the
 * dashboard, or the admin panel does not lose sight of a call in flight.
 *
 * Fetches its own data rather than driving router.refresh(): refreshing the
 * whole page every few seconds to update a corner widget would re-render
 * whatever the officer is actually reading.
 */
const POLL_ACTIVE_MS = 3000;
const POLL_IDLE_MS = 10_000;

const STAGE = {
  QUEUED: { label: "Calling", dot: "bg-[var(--muted-foreground)]", pulse: false },
  RINGING: { label: "Ringing", dot: "bg-[var(--warning)]", pulse: true },
  CONNECTED: { label: "Live", dot: "bg-[var(--success)]", pulse: true },
  ENDED: { label: "Ended", dot: "bg-[var(--muted-foreground)]", pulse: false },
} as const;

function elapsed(startedAt: string, now: number): string {
  const secs = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
}

export function FloatingCallMonitor() {
  const [calls, setCalls] = useState<LiveCallSummary[]>([]);
  const [open, setOpen] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  // Held in refs so a slow request cannot overlap the next tick, and so the
  // poll cadence can react to activity without becoming an effect dependency —
  // `load` sets `calls`, so depending on calls.length would tear the timers
  // down and rebuild them on every update.
  const busy = useRef(false);
  const activeRef = useRef(false);

  const load = useCallback(async () => {
    // Only overlap is guarded here. Visibility is the SCHEDULER's concern —
    // putting it in load() meant a workspace opened in a background tab never
    // populated at all, because the very first load was skipped along with
    // the polls.
    if (busy.current) return;
    busy.current = true;
    try {
      const res = await fetch("/api/calls/live", { cache: "no-store" });
      if (!res.ok) return; // 403 or a blip — keep showing what we have.
      const data = (await res.json()) as { calls: LiveCallSummary[] };
      // Written here rather than during render: the poll cadence reads it, and
      // updating a ref while rendering is neither allowed nor necessary.
      activeRef.current = data.calls.length > 0;
      setCalls(data.calls);
    } catch {
      // Deliberately silent, and deliberately does NOT clear `calls`.
      // A dropped poll must not make a live call vanish from the screen —
      // that flicker is the exact behaviour this widget exists to replace.
    } finally {
      busy.current = false;
    }
  }, []);

  useEffect(() => {
    // One self-rescheduling timer instead of a fixed interval, so the cadence
    // can change with activity without recreating the effect. The first run is
    // scheduled at 0 rather than called inline — it still fires immediately,
    // but keeps the effect body free of state updates.
    let timer: ReturnType<typeof setTimeout>;
    let first = true;

    const schedule = (delay: number) => {
      timer = setTimeout(async () => {
        // The FIRST load always runs, even in a background tab, so a workspace
        // opened behind another tab is correct the moment it is looked at.
        // Subsequent polls skip the work while hidden but keep the timer
        // alive, so polling resumes without waiting for a visibility event.
        if (first || !document.hidden) await load();
        first = false;
        schedule(activeRef.current ? POLL_ACTIVE_MS : POLL_IDLE_MS);
      }, delay);
    };
    schedule(0);

    const onVisibility = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load]);

  // A once-per-second clock so the elapsed timers advance. Separated from the
  // polling effect because it is display-only — it must keep running even when
  // a poll is in flight or failing.
  useEffect(() => {
    if (calls.length === 0) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [calls.length]);

  if (calls.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-40 w-[min(22rem,calc(100vw-2rem))]">
      <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] shadow-lg">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="focus-ring flex w-full items-center gap-2 border-b border-[var(--border)] px-3 py-2.5 text-left"
        >
          <Radio className="h-3.5 w-3.5 animate-pulse text-[var(--success)]" />
          <span className="text-[13px] font-semibold text-[var(--foreground)]">
            {calls.length} call{calls.length === 1 ? "" : "s"} in progress
          </span>
          {open ? (
            <ChevronDown className="ml-auto h-4 w-4 text-[var(--muted-foreground)]" />
          ) : (
            <ChevronUp className="ml-auto h-4 w-4 text-[var(--muted-foreground)]" />
          )}
        </button>

        {open && (
          <div className="max-h-[18rem] overflow-y-auto">
            {calls.map((c) => {
              const stage = STAGE[c.stage] ?? STAGE.QUEUED;
              return (
                <div key={c.conversationId} className="border-b border-[var(--border)] px-3 py-2.5 last:border-0">
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${stage.dot} ${stage.pulse ? "animate-pulse" : ""}`} />
                    <Link
                      href={`/workspace/leads/${c.leadPublicRef}`}
                      className="truncate text-[13px] font-medium text-[var(--foreground)] hover:text-[var(--primary)]"
                    >
                      {c.borrowerName}
                    </Link>
                    <span className="ml-auto shrink-0 text-xs text-[var(--muted-foreground)]">
                      {stage.label} · {elapsed(c.startedAt, now)}
                    </span>
                  </div>
                  {c.lastLine && (
                    <p className="mt-1 truncate pl-4 text-xs text-[var(--muted-foreground)]">{c.lastLine}</p>
                  )}
                </div>
              );
            })}
            <Link
              href="/workspace/calls"
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[var(--primary)] hover:underline"
            >
              <PhoneCall className="h-3 w-3" /> Open the call centre
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
