"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, CheckSquare, Layers3, Square } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { SnoozeSelect } from "@/components/workspace/snooze-select";
import { bulkUpdateTasksAction, completeTaskAction } from "@/domain/actions";
import { formatDateTime, titleCase } from "@/lib/utils";
import type { TaskWithLead } from "@/domain/queries";
import type { TaskStatus } from "@/domain/types";

const STATUS_TONE: Record<TaskWithLead["status"], "neutral" | "success" | "warning"> = {
  OPEN: "warning",
  COMPLETED: "success",
  CANCELLED: "neutral",
};

export function TaskQueueList({ tasks }: { tasks: TaskWithLead[] }) {
  const [isPending, startTransition] = useTransition();
  const { push } = useToast();
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [targetStatus, setTargetStatus] = useState<TaskStatus>("COMPLETED");

  const allSelected = tasks.length > 0 && tasks.every((task) => selected.has(task.id));

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function bulkMove(status = targetStatus) {
    startTransition(async () => {
      const result = await bulkUpdateTasksAction([...selected], status);
      push({ title: result.message, tone: result.ok ? "success" : "danger" });
      if (result.ok) setSelected(new Set());
      router.refresh();
    });
  }

  function complete(t: TaskWithLead) {
    startTransition(async () => {
      const result = await completeTaskAction(t.leadPublicRef, t.id);
      push({ title: result.message, tone: result.ok ? "success" : "danger" });
      router.refresh();
    });
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-3">
        <label className="flex cursor-pointer items-center gap-2 text-[13px] font-medium text-[var(--foreground)]">
          <Checkbox
            checked={allSelected}
            onChange={() => setSelected(allSelected ? new Set() : new Set(tasks.map((task) => task.id)))}
          />
          {selected.size > 0 ? `${selected.size} selected` : "Select all visible"}
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" disabled={selected.size === 0} loading={isPending} onClick={() => bulkMove("COMPLETED")}>
            <Check className="h-3.5 w-3.5" /> Clear selected
          </Button>
          <Select value={targetStatus} onChange={(event) => setTargetStatus(event.target.value as TaskStatus)} className="w-auto" aria-label="Bulk task stage">
            <option value="OPEN">Open</option>
            <option value="COMPLETED">Completed</option>
            <option value="CANCELLED">Cancelled</option>
          </Select>
          <Button size="sm" disabled={selected.size === 0} loading={isPending} onClick={() => bulkMove()}>
            <Layers3 className="h-3.5 w-3.5" /> Move stage
          </Button>
        </div>
      </div>
      <CardContent className="divide-y divide-[var(--border)] p-0">
        {tasks.map((t) => {
          const overdue = t.overdue;
          return (
            <div key={t.id} className="flex items-center justify-between gap-3 px-5 py-3.5">
              <div className="flex min-w-0 items-center gap-2.5 text-left">
                <Checkbox checked={selected.has(t.id)} onChange={() => toggle(t.id)} aria-label={`Select ${t.title}`} />
                <button disabled={t.status !== "OPEN" || isPending} onClick={() => complete(t)} title={t.status === "OPEN" ? "Complete task" : undefined}>
                  {t.status === "COMPLETED" ? (
                    <CheckSquare className="h-4 w-4 shrink-0 text-[var(--success)]" />
                  ) : (
                    <Square className="h-4 w-4 shrink-0 text-[var(--muted-foreground)] hover:text-[var(--primary)]" />
                  )}
                </button>
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium text-[var(--foreground)]">{t.title}</p>
                  <p className={`text-xs ${overdue ? "font-medium text-[var(--danger)]" : "text-[var(--muted-foreground)]"}`}>
                    {titleCase(t.type)} · due {formatDateTime(t.dueAt)}
                  </p>
                </div>
              </div>
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
