import { ExternalLink, Radar, ShieldX } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ReadMore } from "@/components/ui/read-more";
import { EmptyState } from "@/components/ui/empty-state";
import { RunDiscoveryButton } from "@/components/discovery/run-discovery-button";
import { SignalActions } from "@/components/discovery/signal-actions";
import { DiscoveryFilters } from "@/components/discovery/discovery-filters";
import { RedditConnectionControls } from "@/components/discovery/reddit-connection-controls";
import { can } from "@/core/rbac";
import { listSignals } from "@/domain/queries";
import { getCurrentUser } from "@/domain/session";
import { getDb } from "@/domain/store";
import { getConfigValue } from "@/lib/runtimeConfig";
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

interface PageProps {
  searchParams: Promise<{ q?: string; status?: string; intent?: string; urgency?: string; source?: string; sort?: string }>;
}

export default async function DiscoveryPage({ searchParams }: PageProps) {
  const params = await searchParams;
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

  const allSignals = await listSignals();
  const db = await getDb();
  const commercialApproved = (await getConfigValue("REDDIT_COMMERCIAL_APPROVED")) === "true";
  const redditConnection = Array.from(db.redditConnections.values()).find((item) => !item.revokedAt);
  const canPublish = commercialApproved && Boolean(redditConnection) && db.config.featureFlags?.redditPosting === true;
  const values = {
    q: params.q?.trim() ?? "",
    status: ["NEW", "REVIEWED", "ACTIONED", "DISMISSED"].includes(params.status ?? "") ? params.status! : "all",
    intent: ["REFINANCE", "CASH_OUT", "HOME_EQUITY", "UNKNOWN"].includes(params.intent ?? "") ? params.intent! : "",
    urgency: ["IMMEDIATE", "WEEKS", "RESEARCHING", "UNKNOWN"].includes(params.urgency ?? "") ? params.urgency! : "",
    source: ["REDDIT", "FORUM"].includes(params.source ?? "") ? params.source! : "",
    sort: ["priority", "confidence", "newest", "oldest"].includes(params.sort ?? "") ? params.sort! : "priority",
  };
  const needle = values.q.toLowerCase();
  const signals = allSignals
    .filter((signal) => values.status === "all" || signal.status === values.status)
    .filter((signal) => !values.intent || signal.detectedIntent === values.intent)
    .filter((signal) => !values.urgency || (signal.assessment?.urgency ?? "UNKNOWN") === values.urgency)
    .filter((signal) => !values.source || signal.source === values.source)
    .filter((signal) => !needle || [signal.title, signal.snippet, signal.authorHandle, signal.sourceLabel, ...signal.matchedKeywords].some((part) => part?.toLowerCase().includes(needle)))
    .sort((a, b) => {
      if (values.sort === "newest") return Date.parse(b.postedAt) - Date.parse(a.postedAt);
      if (values.sort === "oldest") return Date.parse(a.postedAt) - Date.parse(b.postedAt);
      if (values.sort === "confidence") return b.confidence - a.confidence;
      const statusWeight = (signal: DiscoveredSignal) => signal.status === "NEW" ? 1 : 0;
      const urgencyWeight = (signal: DiscoveredSignal) => ({ IMMEDIATE: 3, WEEKS: 2, RESEARCHING: 1, UNKNOWN: 0 })[signal.assessment?.urgency ?? "UNKNOWN"];
      return statusWeight(b) - statusWeight(a) || urgencyWeight(b) - urgencyWeight(a) || b.confidence - a.confidence;
    });
  const awaitingReview = allSignals.filter((signal) => signal.status === "NEW").length;
  const urgent = allSignals.filter((signal) => signal.status === "NEW" && signal.assessment?.urgency === "IMMEDIATE").length;

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Lead Discovery"
        description="Public posts expressing refinance or equity-buyout intent, classified and queued for review — never auto-contacted."
        actions={<div className="flex gap-2"><RedditConnectionControls accountName={redditConnection?.accountName} approved={commercialApproved} /><RunDiscoveryButton /></div>}
      />

      <div className="mb-5 flex items-center gap-2">
        <Badge tone="success">Arctic Shift ready</Badge>
        <Badge tone="neutral">Free read-only source · human review only</Badge>
        {redditConnection && <Badge tone="neutral">Connected u/{redditConnection.accountName}</Badge>}
        <Badge tone="neutral">Last 14 days</Badge>
        <Badge tone="neutral">{awaitingReview} awaiting review</Badge>
        {urgent > 0 && <Badge tone="warning">{urgent} acting now</Badge>}
      </div>

      <DiscoveryFilters values={values} />

      {signals.length === 0 ? (
        <Card>
          <EmptyState
            icon={Radar}
            title="No signals yet"
            description={allSignals.length === 0 ? "Click Run discovery to search for public posts mentioning refinancing or home equity." : "No signals match the current filters."}
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {signals.map((signal) => (
            <Card key={signal.id}>
              <CardContent className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                      <Badge tone="neutral">{signal.sourceLabel ?? `r/${signal.subreddit}`}</Badge>
                      <Badge tone={INTENT_TONE[signal.detectedIntent]}>
                        {signal.detectedIntent.replace("_", " ")} · {Math.round(signal.confidence * 100)}%
                      </Badge>
                      <Badge tone={STATUS_TONE[signal.status]}>{signal.status}</Badge>
                    </div>
                    <a
                      href={signal.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      title="Opens the original thread on Reddit."
                      className="group inline-flex items-center gap-1.5 text-[14px] font-medium text-[var(--foreground)] hover:text-[var(--primary)]"
                    >
                      {signal.title}
                      <ExternalLink className="h-3 w-3 shrink-0 text-[var(--muted-foreground)] group-hover:text-[var(--primary)]" />
                    </a>
                    {/* Forum posts run to hundreds of words. Showing them in
                        full made a 50-item queue unscannable — the reviewer's
                        job is to triage, and the full text only matters once
                        they have decided this one is worth reading. */}
                    <ReadMore text={signal.snippet} lines={2} className="mt-1" />
                    <p className="mt-2 text-xs text-[var(--muted-foreground)]">
                      {signal.authorHandle} · {formatRelative(signal.postedAt)}
                      {signal.matchedKeywords.length > 0 && <> · matched &ldquo;{signal.matchedKeywords.join(", ")}&rdquo;</>}
                    </p>

                    {signal.assessment && (
                      <div className="mt-2.5 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--background)] p-2.5">
                        <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                          <Badge tone="primary">AI read</Badge>
                          {signal.assessment.urgency !== "UNKNOWN" && (
                            <Badge tone={signal.assessment.urgency === "IMMEDIATE" ? "success" : "neutral"}>
                              {signal.assessment.urgency === "IMMEDIATE"
                                ? "Acting now"
                                : signal.assessment.urgency === "WEEKS"
                                  ? "Next few weeks"
                                  : "Researching"}
                            </Badge>
                          )}
                          {/* Both numbers, because they can disagree — and the
                              disagreement is the interesting part. */}
                          {signal.baseScore !== undefined && (
                            <span className="text-xs text-[var(--muted-foreground)]">
                              keyword {signal.baseScore} · AI {signal.assessment.qualityScore}
                            </span>
                          )}
                        </div>
                        {signal.assessment.situation && (
                          <p className="text-[13px] text-[var(--foreground)]">{signal.assessment.situation}</p>
                        )}
                        {signal.assessment.suggestedAngle && (
                          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                            <span className="font-medium">Angle:</span> {signal.assessment.suggestedAngle}
                          </p>
                        )}
                        {signal.assessment.concerns.length > 0 && (
                          <p className="mt-1 text-xs text-[var(--warning)]">
                            <span className="font-medium">Watch:</span> {signal.assessment.concerns.join("; ")}
                          </p>
                        )}
                      </div>
                    )}
                    {signal.reviewNote && (
                      <p className="mt-1.5 text-xs italic text-[var(--muted-foreground)]">
                        {signal.reviewedByName}: &ldquo;{signal.reviewNote}&rdquo;
                      </p>
                    )}
                  </div>
                  {signal.status === "NEW" && (
                    <SignalActions signalId={signal.id} canPromote={user.role === "ADMIN"} canPublish={canPublish} />
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
