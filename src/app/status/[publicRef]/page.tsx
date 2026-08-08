import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Landmark, CheckCircle2, Clock, UserCheck, Phone, Mail } from "lucide-react";
import { getLeadByRef } from "@/domain/queries";
import { StatusMessageForm } from "@/components/status/status-message-form";
import { formatDate, formatDateTime } from "@/lib/utils";
import type { LeadState } from "@/domain/types";

// A specific borrower's name and loan status — not meant for search
// discovery even though it's only reachable via an unguessable token.
export const metadata: Metadata = { robots: { index: false, follow: false } };

interface PageProps {
  params: Promise<{ publicRef: string }>;
}

// A deliberately minimal, high-level status view — not a full loan-progress
// tracker. The loan officer's own downstream system (or the broker's) is
// where the actual application timeline lives; this just answers "did they
// get my inquiry and is someone on it," which is what a borrower checking
// back actually wants to know.
type Stage = "submitted" | "reaching_out" | "in_conversation" | "with_officer" | "closed_won" | "closed_lost" | "paused";

const STAGE_FOR_STATE: Record<LeadState, Stage> = {
  NEW: "submitted",
  ATTEMPTING_CONTACT: "reaching_out",
  NURTURE: "reaching_out",
  STALE: "reaching_out",
  IN_CONVERSATION: "in_conversation",
  QUALIFYING: "in_conversation",
  READY_FOR_HANDOFF: "with_officer",
  ASSIGNED: "with_officer",
  ACKNOWLEDGED: "with_officer",
  CLOSED_WON: "closed_won",
  CLOSED_LOST: "closed_lost",
  SUPPRESSED: "paused",
};

const STEPS: { stage: Stage; label: string }[] = [
  { stage: "submitted", label: "Submitted" },
  { stage: "reaching_out", label: "Reaching out" },
  { stage: "in_conversation", label: "In conversation" },
  { stage: "with_officer", label: "With your officer" },
];

const STEP_ORDER: Stage[] = ["submitted", "reaching_out", "in_conversation", "with_officer"];

export default async function BorrowerStatusPage({ params }: PageProps) {
  const { publicRef } = await params;
  const detail = await getLeadByRef(publicRef);
  if (!detail) notFound();

  const { lead, person, officer } = detail;
  const stage = STAGE_FOR_STATE[lead.state];
  const firstName = person?.firstName || "there";
  const currentIndex = STEP_ORDER.indexOf(stage);
  const goneQuiet = stage === "reaching_out" && lead.attemptsTotal >= 2;

  return (
    <main className="flex-1 overflow-y-auto bg-[var(--background)]">
      <div className="mx-auto max-w-lg px-6 py-12">
        <div className="mb-8 flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] bg-[var(--primary)] text-white">
            <Landmark className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-[15px] font-semibold text-[var(--foreground)]">Equity Flow Group</h1>
            <p className="text-xs text-[var(--muted-foreground)]">Inquiry status</p>
          </div>
        </div>

        <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[var(--shadow-sm)]">
          <p className="text-[15px] font-semibold text-[var(--foreground)]">Hi {firstName} — here&apos;s where things stand</p>
          <p className="mt-1 text-[13px] text-[var(--muted-foreground)]">
            Reference <span className="font-mono font-medium text-[var(--foreground)]">{lead.publicRef}</span> · submitted {formatDate(lead.createdAt)}
          </p>
          {(lead.lastAttemptAt || detail.nextAttemptEta) && (
            <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--muted-foreground)]">
              {lead.lastAttemptAt && (
                <span>
                  Last reached out <span className="font-medium text-[var(--foreground)]">{formatDateTime(lead.lastAttemptAt)}</span>
                </span>
              )}
              {detail.nextAttemptEta && (
                <span>
                  Next attempt around <span className="font-medium text-[var(--foreground)]">{formatDateTime(detail.nextAttemptEta)}</span>
                </span>
              )}
            </p>
          )}

          {stage === "closed_won" ? (
            <StatusBanner icon={CheckCircle2} tone="success" title="Closed — congratulations!" body="Your loan officer has this wrapped up. Reach out to them directly with any follow-up questions." />
          ) : stage === "closed_lost" ? (
            <StatusBanner icon={Clock} tone="neutral" title="Not moving forward right now" body="This inquiry didn't lead to an offer this time — you're welcome to submit a new inquiry anytime your situation changes." />
          ) : stage === "paused" ? (
            <StatusBanner icon={Clock} tone="warning" title="On hold" body="We're unable to reach you at the contact info on file. If that's changed, please submit a new inquiry with your current details." />
          ) : (
            <div className="mt-5">
              <div className="flex items-center justify-between">
                {STEPS.map((s, i) => (
                  <div key={s.stage} className="flex flex-1 flex-col items-center">
                    <div className="flex w-full items-center">
                      <div className="flex-1">{i > 0 && <div className={`h-0.5 ${i <= currentIndex ? "bg-[var(--primary)]" : "bg-[var(--border)]"}`} />}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-[-14px] flex items-start justify-between">
                {STEPS.map((s, i) => (
                  <div key={s.stage} className="flex flex-1 flex-col items-center text-center">
                    <span
                      className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold ${
                        i < currentIndex
                          ? "bg-[var(--primary)] text-white"
                          : i === currentIndex
                            ? "bg-[var(--primary)] text-white ring-4 ring-[var(--primary-tint)]"
                            : "bg-[var(--background)] text-[var(--muted-foreground)] ring-1 ring-[var(--border-strong)]"
                      }`}
                    >
                      {i < currentIndex ? <CheckCircle2 className="h-3.5 w-3.5" /> : i + 1}
                    </span>
                    <span className={`mt-1.5 text-[10.5px] leading-tight ${i === currentIndex ? "font-semibold text-[var(--foreground)]" : "text-[var(--muted-foreground)]"}`}>
                      {s.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {goneQuiet && (
            <div className="mt-5 flex items-start gap-2.5 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--background)] px-3.5 py-3">
              <Clock className="mt-0.5 h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
              <p className="text-xs leading-relaxed text-[var(--muted-foreground)]">
                We&apos;ve tried reaching you a few times without luck — you&apos;re still in the queue and nothing&apos;s
                been lost. If your contact info has changed, send us a message below.
              </p>
            </div>
          )}

          {officer && stage !== "closed_lost" && (
            <div className="mt-6 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--background)] px-3.5 py-3">
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--primary-tint)] text-[13px] font-semibold text-[var(--primary)]">
                  {officer.name.charAt(0)}
                </span>
                <div>
                  <p className="flex items-center gap-1.5 text-[13px] font-medium text-[var(--foreground)]">
                    <UserCheck className="h-3.5 w-3.5 text-[var(--success)]" /> {officer.name}
                  </p>
                  <p className="text-xs text-[var(--muted-foreground)]">Your licensed loan officer · NMLS {officer.nmlsId}</p>
                </div>
              </div>
              <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5 pl-[46px]">
                {officer.phone && (
                  <a href={`tel:${officer.phone}`} className="flex items-center gap-1.5 text-xs font-medium text-[var(--primary)] hover:underline">
                    <Phone className="h-3.5 w-3.5" /> {officer.phone}
                  </a>
                )}
                <a href={`mailto:${officer.email}`} className="flex items-center gap-1.5 text-xs font-medium text-[var(--primary)] hover:underline">
                  <Mail className="h-3.5 w-3.5" /> {officer.email}
                </a>
              </div>
            </div>
          )}

          <p className="mt-6 text-xs leading-relaxed text-[var(--muted-foreground)]">
            Questions in the meantime? Reply to any text or email you&apos;ve received from us, or call back the number that reached out.
          </p>

          <StatusMessageForm publicRef={lead.publicRef} />
        </div>
      </div>
    </main>
  );
}

function StatusBanner({
  icon: Icon,
  tone,
  title,
  body,
}: {
  icon: React.ElementType;
  tone: "success" | "warning" | "neutral";
  title: string;
  body: string;
}) {
  const toneClasses = {
    success: "border-[var(--success)]/30 bg-[var(--success-tint)] text-[var(--success)]",
    warning: "border-[var(--warning-border)] bg-[var(--warning-tint)] text-[var(--warning)]",
    neutral: "border-[var(--border)] bg-[var(--background)] text-[var(--muted-foreground)]",
  }[tone];

  return (
    <div className={`mt-5 flex items-start gap-2.5 rounded-[var(--radius-md)] border px-3.5 py-3 ${toneClasses}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div>
        <p className="text-[13px] font-semibold text-[var(--foreground)]">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-[var(--muted-foreground)]">{body}</p>
      </div>
    </div>
  );
}
