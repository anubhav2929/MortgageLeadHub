import Link from "next/link";
import { AlertTriangle, PhoneOff, ShieldX } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { LiveCallBoard } from "@/components/workspace/live-call-board";
import { CallFailureAlerts } from "@/components/workspace/call-failure-alerts";
import { can } from "@/core/rbac";
import { listCallActivity, listLiveCalls } from "@/domain/queries";
import { getCurrentUser } from "@/domain/session";
import { currentVoiceStrategy } from "@/domain/voiceOrchestrator";
import { formatDateTime } from "@/lib/utils";
import type { AttemptOutcome } from "@/domain/types";

const OUTCOME_TONE: Record<AttemptOutcome, "neutral" | "primary" | "success" | "warning" | "danger"> = {
  QUEUED: "neutral",
  SENT: "neutral",
  DELIVERED: "primary",
  ANSWERED: "success",
  NO_ANSWER: "warning",
  BUSY: "warning",
  VOICEMAIL: "warning",
  FAILED: "danger",
  BLOCKED: "danger",
  UNDELIVERED: "danger",
};

function duration(seconds?: number): string {
  if (!seconds) return "—";
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export default async function CallCentrePage() {
  const user = await getCurrentUser();
  const subject = { role: user.role, officerId: user.officerId };

  if (!can(subject, "VIEW_LEAD_PII")) {
    return (
      <div className="animate-fade-in">
        <PageHeader title="Call centre" />
        <Card>
          <EmptyState icon={ShieldX} title="Restricted" description="You do not have access to call recordings or transcripts." />
        </Card>
      </div>
    );
  }

  const [live, activity, strategy] = await Promise.all([
    listLiveCalls(),
    listCallActivity(80),
    currentVoiceStrategy(),
  ]);

  // Surfaced separately rather than left in the log: a run of failures is a
  // provider problem, and reading it as "some calls didn't connect" is how a
  // broken credential goes unnoticed for a day.
  // Only unacknowledged failures raise the band. Dismissing one hides the
  // alert; the row stays in the call log below with its message intact.
  const failures = activity.filter((e) => e.attempt.outcome === "FAILED" && !e.attempt.acknowledgedAt);

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Call centre"
        description="Every outbound call — automated and manual — in one place, with live transcripts as they happen."
      />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Badge tone={strategy.mechanism === "VAPI_AGENT" ? "success" : strategy.mechanism === "ANNOUNCEMENT" ? "warning" : "neutral"}>
          {strategy.mechanism === "VAPI_AGENT"
            ? "AI agent — two-way, transcribed"
            : strategy.mechanism === "ANNOUNCEMENT"
              ? "Announcement only — no transcript"
              : "No voice provider connected"}
        </Badge>
        <Badge tone={live.length > 0 ? "success" : "neutral"}>{live.length} live now</Badge>
      </div>

      {/* Stated up front, because a board that is permanently empty is
          otherwise indistinguishable from a quiet day. */}
      {strategy.mechanism !== "VAPI_AGENT" && (
        <Card className="mb-5 border-[var(--warning)] bg-[var(--warning-tint)]">
          <CardContent className="flex items-start gap-2.5 p-4">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--warning)]" />
            <div>
              <p className="text-[13px] font-medium text-[var(--foreground)]">{strategy.reason}</p>
              {strategy.remedy && (
                <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">{strategy.remedy}</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <h2 className="mb-2 text-[15px] font-semibold text-[var(--foreground)]">In progress</h2>
      <LiveCallBoard calls={live} />

      <CallFailureAlerts failures={failures} />

      <h2 className="mb-2 mt-6 text-[15px] font-semibold text-[var(--foreground)]">Call log</h2>
      {activity.length === 0 ? (
        <Card>
          <EmptyState icon={PhoneOff} title="No calls yet" description="Outbound calls appear here as soon as the first one is placed." />
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead className="border-b border-[var(--border)] text-xs text-[var(--muted-foreground)]">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Borrower</th>
                    <th className="px-4 py-2.5 font-medium">When</th>
                    <th className="px-4 py-2.5 font-medium">Outcome</th>
                    <th className="px-4 py-2.5 font-medium">Duration</th>
                    <th className="px-4 py-2.5 font-medium">Transcript</th>
                  </tr>
                </thead>
                <tbody>
                  {activity.map((e) => (
                    <tr key={e.attempt.id} className="border-b border-[var(--border)] last:border-0">
                      <td className="px-4 py-2.5">
                        <Link href={`/workspace/leads/${e.leadPublicRef}`} className="font-medium hover:text-[var(--primary)]">
                          {e.borrowerName}
                        </Link>
                        {e.stateCode && <span className="ml-1.5 text-xs text-[var(--muted-foreground)]">{e.stateCode}</span>}
                      </td>
                      <td className="px-4 py-2.5 text-[var(--muted-foreground)]">
                        {formatDateTime(e.attempt.startedAt ?? e.attempt.scheduledFor)}
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge tone={OUTCOME_TONE[e.attempt.outcome]}>{e.attempt.outcome.replace("_", " ")}</Badge>
                      </td>
                      <td className="px-4 py-2.5 text-[var(--muted-foreground)]">{duration(e.attempt.durationSec)}</td>
                      <td className="px-4 py-2.5 text-[var(--muted-foreground)]">
                        {e.conversation
                          ? `${e.conversation.transcript.length} turn${e.conversation.transcript.length === 1 ? "" : "s"}`
                          : // An announcement call is one-way, so "no transcript"
                            // is the expected state rather than a missing one.
                            "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
