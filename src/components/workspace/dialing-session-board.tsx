"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Pause, Play, SkipForward, Square, PhoneCall } from "lucide-react";
import { advanceDialingSessionAction, updateDialingSessionAction } from "@/domain/actions";
import { dialingSessionProgress } from "@/core/dialingQueue";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/components/ui/toast";
import type { DialingSessionView } from "@/domain/queries";

export function DialingSessionBoard({ sessions }: { sessions: DialingSessionView[] }) {
  const router = useRouter();
  const { push } = useToast();
  const [pendingId, setPendingId] = useState<string>();
  const [isPending, startTransition] = useTransition();

  function run(sessionId: string, operation: "NEXT" | "PAUSE" | "RESUME" | "CANCEL" | "SKIP_NEXT") {
    setPendingId(sessionId);
    startTransition(async () => {
      const result = operation === "NEXT"
        ? await advanceDialingSessionAction(sessionId)
        : await updateDialingSessionAction(sessionId, operation);
      push({ title: result.message, tone: result.ok ? "success" : "danger" });
      setPendingId(undefined);
      router.refresh();
    });
  }

  if (sessions.length === 0) return null;
  return (
    <section className="mb-6" aria-labelledby="dialing-sessions-title">
      <h2 id="dialing-sessions-title" className="mb-2 text-[15px] font-semibold text-[var(--foreground)]">Back-to-back call lists</h2>
      <div className="space-y-3">
        {sessions.map(({ session, items }) => {
          const progress = dialingSessionProgress(items);
          const current = session.currentItemId ? items.find((item) => item.id === session.currentItemId) : undefined;
          const next = items.find((item) => item.status === "PENDING");
          const busy = isPending && pendingId === session.id;
          return (
            <Card key={session.id}>
              <CardContent className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[14px] font-semibold text-[var(--foreground)]">{session.name}</p>
                      <Badge tone={session.status === "ACTIVE" ? "success" : session.status === "PAUSED" ? "warning" : "neutral"}>{session.status}</Badge>
                      <Badge tone="neutral">{session.mode === "AUTO_SEQUENTIAL" ? "Automatic · one at a time" : "Operator advances"}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                      {progress.completed} of {progress.total} settled · created by {session.createdByName}
                      {current ? ` · currently calling ${current.borrowerName}` : next ? ` · next: ${next.borrowerName}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {session.mode === "MANUAL_NEXT" && session.status === "ACTIVE" && (
                      <Button size="sm" loading={busy} disabled={Boolean(current)} onClick={() => run(session.id, "NEXT")}>
                        <PhoneCall className="h-3.5 w-3.5" /> Dial next
                      </Button>
                    )}
                    {session.status === "ACTIVE" && <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(session.id, "PAUSE")}><Pause className="h-3.5 w-3.5" /> Pause</Button>}
                    {session.status === "PAUSED" && <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(session.id, "RESUME")}><Play className="h-3.5 w-3.5" /> Resume</Button>}
                    {session.status === "ACTIVE" && !current && next && <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(session.id, "SKIP_NEXT")}><SkipForward className="h-3.5 w-3.5" /> Skip next</Button>}
                    {!(["COMPLETED", "CANCELLED"] as string[]).includes(session.status) && <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(session.id, "CANCEL")}><Square className="h-3.5 w-3.5 text-[var(--danger)]" /> Stop list</Button>}
                  </div>
                </div>
                <Progress className="mt-3" value={progress.total ? progress.completed / progress.total * 100 : 0} />
                <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                  {items.map((item) => (
                    <Link key={item.id} href={`/workspace/leads/${item.publicRef}`} title={item.reason}
                      className="shrink-0 rounded-md border border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--foreground)] hover:border-[var(--border-strong)]">
                      {item.position + 1}. {item.borrowerName} · <span className="text-[var(--muted-foreground)]">{item.status.toLowerCase()}</span>
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
