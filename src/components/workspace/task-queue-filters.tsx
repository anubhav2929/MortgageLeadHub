"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Select } from "@/components/ui/input";
import { titleCase } from "@/lib/utils";
import type { TaskType } from "@/domain/types";

const TASK_TYPES: TaskType[] = [
  "FIRST_CONTACT",
  "FOLLOW_UP",
  "REVIEW_MISSING_FIELDS",
  "ACKNOWLEDGE_HANDOFF",
  "COMPLAINT",
  "NO_ELIGIBLE_OFFICER",
  "PRIORITY_CALLBACK_REQUESTED",
  "HOT_LEAD_ALERT",
  "BORROWER_MESSAGE",
];

export function TaskQueueFilters({
  isOfficer,
  scope,
  status,
  type,
}: {
  isOfficer: boolean;
  scope: "mine" | "all";
  status: "open" | "completed" | "all";
  type: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {isOfficer && (
        <div className="flex items-center gap-1 rounded-[var(--radius-md)] border border-[var(--border-strong)] bg-[var(--surface)] p-0.5">
          <button
            onClick={() => setParam("scope", "")}
            className={`h-8 rounded-[var(--radius-sm)] px-3 text-[13px] font-medium transition-colors ${
              scope === "mine" ? "bg-[var(--primary)] text-white" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            }`}
          >
            My tasks
          </button>
          <button
            onClick={() => setParam("scope", "all")}
            className={`h-8 rounded-[var(--radius-sm)] px-3 text-[13px] font-medium transition-colors ${
              scope === "all" ? "bg-[var(--primary)] text-white" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            }`}
          >
            All tasks
          </button>
        </div>
      )}
      <div className="flex items-center gap-1 rounded-[var(--radius-md)] border border-[var(--border-strong)] bg-[var(--surface)] p-0.5">
        {(["open", "completed", "all"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setParam("status", s === "open" ? "" : s)}
            className={`h-8 rounded-[var(--radius-sm)] px-3 text-[13px] font-medium capitalize transition-colors ${
              status === s ? "bg-[var(--primary)] text-white" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            }`}
          >
            {s}
          </button>
        ))}
      </div>
      <Select value={type} onChange={(e) => setParam("type", e.target.value)} className="w-auto min-w-40">
        <option value="">All task types</option>
        {TASK_TYPES.map((t) => (
          <option key={t} value={t}>
            {titleCase(t)}
          </option>
        ))}
      </Select>
    </div>
  );
}
