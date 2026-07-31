"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { CheckSquare, Square } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { SnoozeSelect } from "@/components/workspace/snooze-select";
import { completeTaskAction } from "@/domain/actions";
import { formatDateTime, titleCase } from "@/lib/utils";
import type { TaskWithLead } from "@/domain/queries";

const STATUS_TONE: Record<TaskWithLead["status"], "neutral" | "success" | "warning"> = {
  OPEN: "warning",
  COMPLETED: "success",
  CANCELLED: "neutral",
};

export function TaskQueueList({ tasks }: { tasks: TaskWithLead[] }) {
  const [isPending, startTransition] = useTransition();
  const { push } = useToast();
  const router = useRouter();

  function complete(t: TaskWithLead) {
    startTransition(async () => {
      const result = await completeTaskAction(t.leadPublicRef, t.id);
      push({ title: result.message, tone: result.ok ? "success" : "danger" });
      router.refresh();
    });
  }

  return (
    <Card>
      <CardContent className="divide-y divide-[var(--border)] p-0">
        {tasks.map((t) => {
          const overdue = t.overdue;
          return (
            <div key={t.id} className="flex items-center justify-between gap-3 px-5 py-3.5">
              <button
                className="flex min-w-0 items-center gap-2.5 text-left disabled:cursor-default"
                disabled={t.status !== "OPEN" || isPending}
                onClick={() => complete(t)}
              >
                {t.status === "COMPLETED" ? (
                  <CheckSquare className="h-4 w-4 shrink-0 text-[var(--success)]" />
                ) : (
                  <Square className="h-4 w-4 shrink-0 text-[var(--muted-foreground)] hover:text-[var(--primary)]" />
                )}
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium text-[var(--foreground)]">{t.title}</p>
                  <p className={`text-xs ${overdue ? "font-medium text-[var(--danger)]" : "text-[var(--muted-foreground)]"}`}>
                    {titleCase(t.type)} · due {formatDateTime(t.dueAt)}
                  </p>
                </div>
              </button>
              <div className="flex shrink-0 items-center gap-3">
                <Link
                  href={`/workspace/leads/${t.leadPublicRef}?tab=tasks`}
                  className="text-[13px] text-[var(--muted)] hover:text-[var(--primary)] hover:underline"
                >
                  {t.leadFullName}
                </Link>
                {t.status === "OPEN" && <SnoozeSelect publicRef={t.leadPublicRef} taskId={t.id} onDone={() => router.refresh()} />}
                <Badge tone={STATUS_TONE[t.status]}>{t.status}</Badge>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
