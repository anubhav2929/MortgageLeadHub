import { ExternalLink, Radar, ShieldX } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { RunDiscoveryButton } from "@/components/discovery/run-discovery-button";
import { SignalActions } from "@/components/discovery/signal-actions";
import { can } from "@/core/rbac";
import { listSignals } from "@/domain/queries";
import { getCurrentUser } from "@/domain/session";
import { getCapabilities } from "@/lib/runtimeConfig";
import { formatRelative } from "@/lib/utils";
import type { DiscoveredSignal } from "@/domain/types";

const INTENT_TONE: Record<string, "neutral" | "primary" | "success" | "warning"> = {
  REFINANCE: "primary",
  CASH_OUT: "success",
  HOME_EQUITY: "success",
  UNKNOWN: "neutral",
};

const STATUS_TONE: Record<DiscoveredSignal["status"], "neutral" | "success" | "warning" | "danger"> = {
  NEW: "warning",
  REVIEWED: "neutral",
  DISMISSED: "neutral",
  ACTIONED: "success",
};

export default async function DiscoveryPage() {
  const caps = await getCapabilities();
  const user = await getCurrentUser();
  const subject = { role: user.role, officerId: user.officerId };

  if (!can(subject, "MANAGE_SUPPRESSION")) {
    return (
      <div className="animate-fade-in">
        <PageHeader title="Lead Discovery" />
        <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)]">
          <EmptyState icon={ShieldX} title="Restricted" description="Admin and Compliance roles only." />
        </div>
      </div>
    );
  }

  const signals = await listSignals();
  const newSignals = signals.filter((s) => s.status === "NEW");
  const reviewedSignals = signals.filter((s) => s.status !== "NEW");

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Lead Discovery"
        description="Public posts expressing refinance or equity-buyout intent, classified and queued for review — never auto-contacted."
        actions={<RunDiscoveryButton />}
      />

      <div className="mb-5 flex items-center gap-2">
        <Badge tone={caps.hasLeadDiscovery ? "success" : "neutral"}>
          {caps.hasLeadDiscovery ? "Live — Reddit search" : "Simulated — set REDDIT_CLIENT_ID/REDDIT_CLIENT_SECRET"}
        </Badge>
        <Badge tone="neutral">{newSignals.length} awaiting review</Badge>
      </div>

      {signals.length === 0 ? (
        <Card>
          <EmptyState
            icon={Radar}
            title="No signals yet"
            description="Click Run discovery to search for public posts mentioning refinancing or home equity."
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {[...newSignals, ...reviewedSignals].map((signal) => (
            <Card key={signal.id}>
              <CardContent className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                      <Badge tone="neutral">r/{signal.subreddit}</Badge>
                      <Badge tone={INTENT_TONE[signal.detectedIntent]}>
                        {signal.detectedIntent.replace("_", " ")} · {Math.round(signal.confidence * 100)}%
                      </Badge>
                      <Badge tone={STATUS_TONE[signal.status]}>{signal.status}</Badge>
                    </div>
                    <a
                      href={signal.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      title={caps.hasLeadDiscovery ? undefined : "Simulated post — link goes to the real subreddit, not this exact (fictional) thread."}
                      className="group inline-flex items-center gap-1.5 text-[14px] font-medium text-[var(--foreground)] hover:text-[var(--primary)]"
                    >
                      {signal.title}
                      <ExternalLink className="h-3 w-3 shrink-0 text-[var(--muted-foreground)] group-hover:text-[var(--primary)]" />
                    </a>
                    <p className="mt-1 text-[13px] leading-relaxed text-[var(--muted-foreground)]">{signal.snippet}</p>
                    <p className="mt-2 text-xs text-[var(--muted-foreground)]">
                      {signal.authorHandle} · {formatRelative(signal.postedAt)}
                      {signal.matchedKeywords.length > 0 && <> · matched &ldquo;{signal.matchedKeywords.join(", ")}&rdquo;</>}
                    </p>
                    {signal.reviewNote && (
                      <p className="mt-1.5 text-xs italic text-[var(--muted-foreground)]">
                        {signal.reviewedByName}: &ldquo;{signal.reviewNote}&rdquo;
                      </p>
                    )}
                  </div>
                  {signal.status === "NEW" && (
                    <SignalActions signalId={signal.id} canPromote={user.role === "ADMIN"} />
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
