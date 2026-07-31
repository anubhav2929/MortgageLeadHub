import Link from "next/link";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDateTime, titleCase } from "@/lib/utils";
import type { TaskWithLead } from "@/domain/queries";

const MAX_SHOWN = 8;

/** The dashboard was pure analytics with nothing actionable — an officer
 *  landed here and had to go dig through the Leads and Tasks pages to find
 *  out what actually needed doing right now. This surfaces that directly. */
export function WorkQueueCard({ tasks, scopeLabel }: { tasks: TaskWithLead[]; scopeLabel: string }) {
  const open = tasks.filter((t) => t.status === "OPEN").slice(0, MAX_SHOWN);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Needs attention</CardTitle>
            <CardDescription>Open tasks {scopeLabel}, soonest due first.</CardDescription>
          </div>
          <Link href="/workspace/tasks" className="flex items-center gap-1 text-[13px] font-medium text-[var(--primary)] hover:underline">
            View all <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </CardHeader>
      <CardContent className={open.length === 0 ? "" : "space-y-0 divide-y divide-[var(--border)] p-0"}>
        {open.length === 0 ? (
          <EmptyState icon={AlertTriangle} title="Nothing outstanding" description="Every open task is either done or not yet due." />
        ) : (
          open.map((t) => (
            <Link
              key={t.id}
              href={`/workspace/leads/${t.leadPublicRef}?tab=tasks`}
              className="flex items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-[var(--background)]"
            >
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium text-[var(--foreground)]">{t.title}</p>
                <p className={`text-xs ${t.overdue ? "font-medium text-[var(--danger)]" : "text-[var(--muted-foreground)]"}`}>
                  {titleCase(t.type)} · {t.leadFullName} · due {formatDateTime(t.dueAt)}
                </p>
              </div>
              {t.overdue && <AlertTriangle className="h-4 w-4 shrink-0 text-[var(--danger)]" />}
            </Link>
          ))
        )}
      </CardContent>
    </Card>
  );
}
