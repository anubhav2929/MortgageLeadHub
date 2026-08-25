"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, MessageSquareQuote, Sparkles, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { acceptCallInsightAction, dismissCallInsightAction } from "@/domain/actions";
import { canAcceptInsight, type CallInsight } from "@/core/callInsights";

const KIND_META = {
  CONFLICT: { tone: "danger" as const, label: "Disagrees with the form" },
  CHANGED: { tone: "warning" as const, label: "Changed on the call" },
  NEW: { tone: "primary" as const, label: "New from the call" },
};

function display(v: unknown): string {
  if (v === undefined || v === null || v === "") return "—";
  if (v === "DEBT_CONSOLIDATION") return "simplify monthly payments";
  return String(v).replace(/_/g, " ").toLowerCase();
}

/**
 * What the call told us that the lead record does not yet say.
 *
 * Extraction has always written these into db.leadFields, but the lead header
 * — the thing an officer actually reads before dialling — is only ever written
 * by a manual edit. So a borrower who corrected their goal on a call left the
 * header stale and the correction buried in the Package tab.
 *
 * This is a review surface, not an auto-apply. The record is what the borrower
 * typed and consented to, and a model's reading of a phone call is evidence,
 * not authority.
 */
export function CallInsightsCard({ publicRef, insights }: { publicRef: string; insights: CallInsight[] }) {
  const [isPending, startTransition] = useTransition();
  const { push } = useToast();
  const router = useRouter();

  if (insights.length === 0) return null;

  const run = (fn: typeof acceptCallInsightAction, fieldPath: string) =>
    startTransition(async () => {
      const result = await fn(publicRef, fieldPath);
      push({ title: result.message, tone: result.ok ? "success" : "danger" });
      if (result.ok) router.refresh();
    });

  return (
    <Card className="mb-4 border-[var(--primary)]">
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-[var(--primary)]" />
            {insights.length} thing{insights.length === 1 ? "" : "s"} the call told us
          </CardTitle>
          <CardDescription>
            Extracted from the conversation and not yet reflected on this lead. Accepting updates the lead and locks
            the field against further automated changes.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {insights.map((i) => {
          const meta = KIND_META[i.kind];
          const acceptable = canAcceptInsight(i);
          return (
            <div key={i.fieldPath} className="rounded-[var(--radius-md)] border border-[var(--border)] p-3">
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <span className="text-[13px] font-medium text-[var(--foreground)]">{i.label}</span>
                <Badge tone={meta.tone}>{meta.label}</Badge>
                <span className="text-xs text-[var(--muted-foreground)]">
                  {Math.round(i.confidence * 100)}% confident
                </span>
              </div>

              <p className="text-[13px] text-[var(--foreground)]">
                <span className="text-[var(--muted-foreground)] line-through">{display(i.currentValue)}</span>
                {" → "}
                <strong>{display(i.callValue)}</strong>
              </p>

              {/* Evidence, or its absence, stated plainly. The promotion rules
                  refuse to promote an unevidenced claim; this makes the same
                  standard visible to the person deciding. */}
              <p className="mt-1 flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
                <MessageSquareQuote className="h-3 w-3 shrink-0" />
                {acceptable
                  ? `Heard at turn ${i.turnRefs.join(", ")} of the transcript`
                  : "No transcript reference — review the conversation before accepting"}
              </p>

              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={isPending || !acceptable}
                  onClick={() => run(acceptCallInsightAction, i.fieldPath)}
                >
                  <Check className="h-3.5 w-3.5" /> Accept
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={isPending}
                  onClick={() => run(dismissCallInsightAction, i.fieldPath)}
                >
                  <X className="h-3.5 w-3.5" /> Keep current
                </Button>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
