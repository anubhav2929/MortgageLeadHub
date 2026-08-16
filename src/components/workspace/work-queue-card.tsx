import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { formatRelative, titleCase } from "@/lib/utils";
import type { TaskWithLead } from "@/domain/queries";

const MAX_SHOWN = 5;

/** The dashboard was pure analytics with nothing actionable — an officer
 *  landed here and had to go dig through the Leads and Tasks pages to find
 *  out what actually needed doing right now. This surfaces that directly.
 *
 *  The row leads with the borrower's name rather than the task title,
 *  because in practice most titles are the same string ("First contact
 *  attempt due") and eight identical headlines carry no information — the
 *  name is what tells one row from another. */
export function WorkQueueCard({ tasks, scopeLabel }: { tasks: TaskWithLead[]; scopeLabel: string }) {
  // Blocked-automation items are surfaced separately by BlockedAlertsCard —
  // they need an administrator, not an officer working a queue, and listing
  // them in both places just dilutes each.
  const openTasks = tasks.filter(
    (t) => t.status === "OPEN" && t.type !== "NO_ELIGIBLE_OFFICER" && t.type !== "INTEGRATION_ALERT"
  );
  const open = openTasks.slice(0, MAX_SHOWN);
  const overdueCount = openTasks.filter((t) => t.overdue).length;

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2">
              Needs attention
              {overdueCount > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-[var(--danger-tint)] px-2 py-0.5 text-[11px] font-semibold text-[var(--danger)]">
                  {overdueCount} overdue
                </span>
              )}
            </CardTitle>
            <CardDescription>
              {openTasks.length} open task{openTasks.length === 1 ? "" : "s"} {scopeLabel}, soonest due first.
            </CardDescription>
          </div>
          <Link
            href="/workspace/tasks"
            className="focus-ring flex shrink-0 items-center gap-1 rounded-[var(--radius-sm)] px-2 py-1 text-[13px] font-medium text-[var(--primary)] transition-colors hover:bg-[var(--primary-tint)]"
          >
            View all <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </CardHeader>

      <CardContent className={open.length === 0 ? "" : "space-y-0 divide-y divide-[var(--border)] p-0"}>
        {open.length === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title="All clear"
            description="Every open task is either done or not yet due."
          />
        ) : (
          open.map((t) => (
            <Link
              key={t.id}
              href={`/workspace/leads/${t.leadPublicRef}?tab=tasks`}
              className="group flex items-center gap-3 px-5 py-3 transition-colors hover:bg-[var(--background)]"
            >
              {/* A status rail reads faster than a trailing icon — the eye
                  catches the colour before it reads any text. */}
              <span
                className={`h-8 w-[3px] shrink-0 rounded-full ${
                  t.overdue ? "bg-[var(--danger)]" : "bg-[var(--border-strong)]"
                }`}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold text-[var(--foreground)]">{t.leadFullName}</p>
                <p className="truncate text-xs text-[var(--muted-foreground)]">{titleCase(t.type)}</p>
              </div>
              <div className="shrink-0 text-right">
                <p
                  className={`text-xs font-medium ${
                    t.overdue ? "text-[var(--danger)]" : "text-[var(--muted-foreground)]"
                  }`}
                >
                  {t.overdue ? "Overdue" : "Due"} {formatRelative(t.dueAt)}
                </p>
              </div>
              <ArrowRight className="h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)] opacity-0 transition-opacity group-hover:opacity-100" />
            </Link>
          ))
        )}
      </CardContent>

      {openTasks.length > MAX_SHOWN && (
        <div className="border-t border-[var(--border)] bg-[var(--background)] px-5 py-2.5">
          <Link
            href="/workspace/tasks"
            className="text-xs font-medium text-[var(--muted-foreground)] hover:text-[var(--primary)]"
          >
            {openTasks.length - MAX_SHOWN} more waiting →
          </Link>
        </div>
      )}
    </Card>
  );
}
