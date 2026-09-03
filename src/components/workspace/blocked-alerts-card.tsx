"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { AlertOctagon, ArrowRight, PlugZap, UserX, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { dismissDashboardBlockedAlertsAction } from "@/domain/actions";
import type { TaskWithLead } from "@/domain/queries";

/**
 * "The system cannot proceed without a person" — which is categorically
 * different from "here is your next task", and was previously indistinguishable
 * from it.
 *
 * Both task types below mean automation has stopped for a reason nobody is
 * looking at:
 *
 *  NO_ELIGIBLE_OFFICER — a lead arrived in a state with no licensed, available
 *    officer. It sits in the queue looking ordinary while its SLA clock runs
 *    out, and no amount of retrying fixes it: someone has to add licensing,
 *    raise a capacity limit, or route the lead elsewhere.
 *
 *  INTEGRATION_ALERT — a provider credential or carrier registration is wrong.
 *    This one affects *every* lead, so burying it in a per-lead task list is
 *    exactly the wrong place for it.
 *
 * Rendered as a band above the work queue and hidden entirely when clear, so
 * it carries signal rather than becoming furniture.
 */
export function BlockedAlertsCard({ tasks, dismissedIds = [] }: { tasks: TaskWithLead[]; dismissedIds?: string[] }) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const { push } = useToast();
  const dismissed = new Set(dismissedIds);
  const blocked = tasks.filter(
    (t) => !dismissed.has(t.id) && t.status === "OPEN" && (t.type === "NO_ELIGIBLE_OFFICER" || t.type === "INTEGRATION_ALERT")
  );
  if (blocked.length === 0) return null;

  const integration = blocked.filter((t) => t.type === "INTEGRATION_ALERT");
  const routing = blocked.filter((t) => t.type === "NO_ELIGIBLE_OFFICER");

  return (
    <Card className="mb-4 overflow-hidden border-[var(--danger)] bg-[var(--danger-tint)]">
      <div className="flex items-start gap-3 px-5 py-4">
        <AlertOctagon className="mt-0.5 h-5 w-5 shrink-0 text-[var(--danger)]" />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold text-[var(--foreground)]">
            Automation is blocked on {blocked.length} item{blocked.length === 1 ? "" : "s"}
          </p>
          <p className="mt-0.5 text-[13px] text-[var(--muted-foreground)]">
            These will not resolve on their own — retrying changes nothing until someone acts.
          </p>

          <div className="mt-3 space-y-1.5">
            {integration.length > 0 && (
              <p className="flex items-start gap-2 text-[13px] text-[var(--foreground)]">
                <PlugZap className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--danger)]" />
                <span>
                  <strong>{integration.length} provider problem{integration.length === 1 ? "" : "s"}</strong> — affects
                  every lead.{" "}
                  <Link href="/workspace/admin?tab=integrations" className="font-medium text-[var(--danger)] underline">
                    Check Integrations
                  </Link>
                </span>
              </p>
            )}
            {routing.length > 0 && (
              <p className="flex items-start gap-2 text-[13px] text-[var(--foreground)]">
                <UserX className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--danger)]" />
                <span>
                  <strong>
                    {routing.length} lead{routing.length === 1 ? "" : "s"} with no eligible officer
                  </strong>{" "}
                  — nobody licensed and available in that state.{" "}
                  <Link href="/workspace/admin?tab=officers" className="font-medium text-[var(--danger)] underline">
                    Review officer coverage
                  </Link>
                </span>
              </p>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Link
            href="/workspace/tasks?type=NO_ELIGIBLE_OFFICER"
            className="focus-ring flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-1 text-[13px] font-medium text-[var(--danger)] hover:underline"
          >
            View <ArrowRight className="h-3.5 w-3.5" />
          </Link>
          <Button
            variant="ghost"
            size="icon"
            loading={isPending}
            title="Dismiss this dashboard alert"
            onClick={() => startTransition(async () => {
              const result = await dismissDashboardBlockedAlertsAction(blocked.map((task) => task.id));
              push({ title: result.message, tone: result.ok ? "success" : "danger" });
              if (result.ok) router.refresh();
            })}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </Card>
  );
}
