import {
  Phone,
  MessageSquare,
  Mail,
  UserCheck,
  ShieldOff,
  Clock3,
  CheckCircle2,
  FileText,
  StickyNote,
  AlertTriangle,
  Award,
  XCircle,
  UserCog,
  PhoneOff,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { EditAttemptOutcome } from "@/components/workspace/edit-attempt-outcome";
import { RULE_DESCRIPTIONS } from "@/core/policyGate";
import { formatDateTime } from "@/lib/utils";
import type { ContactAttempt, LeadEvent, RuleCode } from "@/domain/types";

const EVENT_ICON: Partial<Record<LeadEvent["type"], LucideIcon>> = {
  LEAD_CREATED: FileText,
  OUTREACH_ATTEMPTED: Phone,
  OUTREACH_BLOCKED: ShieldOff,
  OUTREACH_DEFERRED: Clock3,
  CONTACT_ANSWERED: PhoneOff,
  CONVERSATION_COMPLETED: CheckCircle2,
  FIELDS_EXTRACTED: FileText,
  PACKAGE_READY: FileText,
  OFFICER_ASSIGNED: UserCheck,
  OFFICER_ACKNOWLEDGED: UserCheck,
  OFFICER_TAKEOVER: UserCog,
  CADENCE_EXHAUSTED: Clock3,
  OPT_OUT_RECEIVED: ShieldOff,
  ESCALATED: AlertTriangle,
  NOTE_ADDED: StickyNote,
  FIELD_CORRECTED: FileText,
  MARKED_WON: Award,
  MARKED_LOST: XCircle,
};

const CHANNEL_ICON: Record<string, LucideIcon> = { VOICE: Phone, SMS: MessageSquare, EMAIL: Mail };

function eventTone(type: LeadEvent["type"]): "neutral" | "success" | "warning" | "danger" | "primary" | "info" {
  if (type === "OUTREACH_BLOCKED" || type === "OPT_OUT_RECEIVED" || type === "MARKED_LOST") return "danger";
  if (type === "OUTREACH_DEFERRED" || type === "ESCALATED" || type === "CADENCE_EXHAUSTED") return "warning";
  if (type === "MARKED_WON" || type === "OFFICER_ACKNOWLEDGED" || type === "CONVERSATION_COMPLETED") return "success";
  if (type === "OUTREACH_ATTEMPTED" || type === "CONTACT_ANSWERED") return "primary";
  return "neutral";
}

function eventLabel(e: LeadEvent): string {
  const base = e.type
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  return base;
}

const OUTCOME_TONE: Record<string, "neutral" | "success" | "warning" | "danger"> = {
  ANSWERED: "success",
  DELIVERED: "success",
  SENT: "success",
  QUEUED: "neutral",
  NO_ANSWER: "warning",
  BUSY: "warning",
  VOICEMAIL: "warning",
  FAILED: "danger",
  BLOCKED: "danger",
  UNDELIVERED: "danger",
};

function CallLogs({ publicRef, attempts }: { publicRef: string; attempts: ContactAttempt[] }) {
  if (attempts.length === 0) return null;
  return (
    <Card className="mb-6">
      <CardHeader>
        <div>
          <CardTitle>Call, text & email logs</CardTitle>
          <CardDescription>Every outbound attempt with full content — editable if the recorded outcome was wrong.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="divide-y divide-[var(--border)] p-0">
        {attempts.map((a) => {
          const CIcon = CHANNEL_ICON[a.channel];
          const hasContent = Boolean(a.body || a.subject);
          return (
            <div key={a.id} className="px-5 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  {CIcon && <CIcon className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />}
                  <div>
                    <p className="text-[13px] font-medium text-[var(--foreground)]">
                      {a.channel} · attempt {a.attemptNumber}
                      {a.aiGenerated && (
                        <span className="ml-1.5 rounded-full bg-[var(--violet-tint)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--violet)]">AI</span>
                      )}
                    </p>
                    <p className="text-xs text-[var(--muted-foreground)]">
                      {formatDateTime(a.scheduledFor)}
                      {a.durationSec !== undefined ? ` · ${Math.floor(a.durationSec / 60)}:${String(a.durationSec % 60).padStart(2, "0")}` : ""}
                      {a.loggedByName ? ` · ${a.loggedByName}` : ""}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <Badge tone={OUTCOME_TONE[a.outcome] ?? "neutral"}>{a.outcome}</Badge>
                  <EditAttemptOutcome publicRef={publicRef} attemptId={a.id} currentOutcome={a.outcome} />
                </div>
              </div>
              {hasContent && (
                <details className="group mt-2">
                  <summary className="cursor-pointer text-xs font-medium text-[var(--primary)]">View content</summary>
                  <div className="mt-1.5 rounded-[var(--radius-sm)] bg-[var(--background)] p-3">
                    {a.subject && <p className="mb-1 text-[13px] font-medium text-[var(--foreground)]">{a.subject}</p>}
                    <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--muted)]">{a.body}</p>
                  </div>
                </details>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

export function TimelineTab({ publicRef, events, attempts }: { publicRef: string; events: LeadEvent[]; attempts: ContactAttempt[] }) {
  if (events.length === 0) {
    return <EmptyState icon={Clock3} title="No events yet" description="Every action on this lead will appear here, including blocked and deferred attempts." />;
  }

  return (
    <div>
      <CallLogs publicRef={publicRef} attempts={attempts} />
      <div className="relative pl-6">
      <div className="absolute left-[11px] top-2 bottom-2 w-px bg-[var(--border)]" />
      <div className="space-y-5">
        {events.map((e) => {
          const Icon = EVENT_ICON[e.type] ?? FileText;
          const tone = eventTone(e.type);
          const reasons = (e.payload?.reasons as RuleCode[] | undefined) ?? [];
          return (
            <div key={e.id} className="relative">
              <div
                className={`absolute -left-6 flex h-[22px] w-[22px] items-center justify-center rounded-full ring-4 ring-[var(--background)]`}
                style={{
                  background:
                    tone === "danger"
                      ? "var(--danger-tint)"
                      : tone === "warning"
                      ? "var(--warning-tint)"
                      : tone === "success"
                      ? "var(--success-tint)"
                      : tone === "primary"
                      ? "var(--primary-tint)"
                      : "var(--background)",
                }}
              >
                <Icon
                  className="h-3 w-3"
                  style={{
                    color:
                      tone === "danger"
                        ? "var(--danger)"
                        : tone === "warning"
                        ? "var(--warning)"
                        : tone === "success"
                        ? "var(--success)"
                        : tone === "primary"
                        ? "var(--primary)"
                        : "var(--muted-foreground)",
                  }}
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[13px] font-medium text-[var(--foreground)]">{eventLabel(e)}</p>
                {e.channel && (
                  <Badge tone="neutral">
                    {(() => {
                      const CIcon = CHANNEL_ICON[e.channel];
                      return CIcon ? <CIcon className="h-3 w-3" /> : null;
                    })()}
                    {e.channel}
                  </Badge>
                )}
                <span className="text-xs text-[var(--muted-foreground)]">
                  {e.actorName ?? e.actorType} · {formatDateTime(e.occurredAt)}
                </span>
              </div>
              {reasons.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {reasons.map((r) => (
                    <span key={r} title={RULE_DESCRIPTIONS[r]} className="rounded-full bg-[var(--background)] px-2 py-0.5 text-[11px] text-[var(--muted)] ring-1 ring-inset ring-[var(--border-strong)]">
                      {r}
                    </span>
                  ))}
                </div>
              )}
              {e.payload?.reason ? (
                <p className="mt-1 text-[13px] text-[var(--muted-foreground)]">&ldquo;{String(e.payload.reason)}&rdquo;</p>
              ) : null}
            </div>
          );
        })}
      </div>
      </div>
    </div>
  );
}
