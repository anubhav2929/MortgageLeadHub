"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PhoneOff, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { acknowledgeCallFailuresAction } from "@/domain/actions";
import { formatDateTime } from "@/lib/utils";
import type { CallCentreEntry } from "@/domain/queries";

/**
 * Provider refusals, dismissible.
 *
 * These used to persist forever, so a credential fixed on Monday still showed
 * four red rows on Friday. A permanent alert stops being an alert — it becomes
 * scenery, and the next real failure lands in a band the operator has already
 * learned to scroll past.
 *
 * Dismissing acknowledges; it never deletes. Each row stays in the call log
 * below with its failure message intact, because a provider refusal is
 * evidence about what did and did not reach a borrower.
 */
export function CallFailureAlerts({ failures }: { failures: CallCentreEntry[] }) {
  const [isPending, startTransition] = useTransition();
  const { push } = useToast();
  const router = useRouter();

  if (failures.length === 0) return null;

  const dismiss = (ids: string[]) =>
    startTransition(async () => {
      const result = await acknowledgeCallFailuresAction(ids);
      push({ title: result.message, tone: result.ok ? "success" : "danger" });
      if (result.ok) router.refresh();
    });

  // A configuration fault repeats identically on every lead, so the count is
  // the useful number, not each row.
  const configuration = failures.filter((f) => f.attempt.failureClass === "CONFIGURATION");

  return (
    <Card className="mt-6 border-[var(--danger)]">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-1.5">
              <PhoneOff className="h-3.5 w-3.5 text-[var(--danger)]" /> {failures.length} call
              {failures.length === 1 ? "" : "s"} the provider refused
            </CardTitle>
            <CardDescription>
              These never reached the borrower.
              {configuration.length > 0 && " A CONFIGURATION fault affects every lead and needs an administrator."}{" "}
              Dismissing keeps them in the call log below.
            </CardDescription>
          </div>
          <Button
            size="sm"
            variant="ghost"
            loading={isPending}
            onClick={() => dismiss(failures.map((f) => f.attempt.id))}
          >
            Dismiss all
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {failures.slice(0, 6).map((f) => (
          <div key={f.attempt.id} className="rounded-[var(--radius-md)] border border-[var(--border)] p-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/workspace/leads/${f.leadPublicRef}`}
                className="text-[13px] font-medium hover:text-[var(--primary)]"
              >
                {f.borrowerName}
              </Link>
              {f.attempt.failureClass && <Badge tone="danger">{f.attempt.failureClass}</Badge>}
              <span className="text-xs text-[var(--muted-foreground)]">
                {formatDateTime(f.attempt.startedAt ?? f.attempt.scheduledFor)}
              </span>
              <button
                type="button"
                aria-label={`Dismiss the failure for ${f.borrowerName}`}
                disabled={isPending}
                onClick={() => dismiss([f.attempt.id])}
                className="focus-ring ml-auto rounded-[var(--radius-sm)] p-1 text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            {f.attempt.failureMessage && (
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">{f.attempt.failureMessage}</p>
            )}
          </div>
        ))}
        {failures.length > 6 && (
          <p className="text-xs text-[var(--muted-foreground)]">
            and {failures.length - 6} more — all in the call log below.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
