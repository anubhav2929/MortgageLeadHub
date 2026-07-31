"use client";

import { useTransition } from "react";
import { Clock } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { snoozeTaskAction } from "@/domain/actions";

const OPTIONS: { label: string; hours: number }[] = [
  { label: "1 hour", hours: 1 },
  { label: "4 hours", hours: 4 },
  { label: "Tomorrow", hours: 24 },
  { label: "3 days", hours: 72 },
  { label: "1 week", hours: 168 },
];

/** Post-action follow-up: reschedule a task's due date without completing
 *  it (which would drop the reminder) or leaving it to just sit overdue. */
export function SnoozeSelect({ publicRef, taskId, onDone }: { publicRef: string; taskId: string; onDone: () => void }) {
  const [isPending, startTransition] = useTransition();
  const { push } = useToast();

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const hours = Number(e.target.value);
    e.target.value = "";
    if (!hours) return;
    startTransition(async () => {
      const result = await snoozeTaskAction(publicRef, taskId, hours);
      push({ title: result.message, tone: result.ok ? "success" : "danger" });
      onDone();
    });
  }

  return (
    <div className="relative flex items-center">
      <Clock className="pointer-events-none absolute left-1.5 h-3 w-3 text-[var(--muted-foreground)]" />
      <select
        defaultValue=""
        disabled={isPending}
        onChange={onChange}
        aria-label="Snooze task"
        className="focus-ring h-7 rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface)] py-0 pl-5 pr-1.5 text-[11.5px] font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] disabled:opacity-60"
      >
        <option value="" disabled>
          Snooze…
        </option>
        {OPTIONS.map((o) => (
          <option key={o.hours} value={o.hours}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
