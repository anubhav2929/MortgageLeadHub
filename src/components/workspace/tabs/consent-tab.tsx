import { CheckCircle2, XCircle, ChevronDown, ShieldQuestion } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { RULE_DESCRIPTIONS } from "@/core/policyGate";
import { formatDateTime } from "@/lib/utils";
import type { ConsentRecord, PolicyDecision } from "@/domain/types";

const SCOPE_LABEL: Record<ConsentRecord["scope"], string> = {
  CONTACT_VOICE: "Voice calls",
  CONTACT_SMS: "SMS messages",
  CONTACT_EMAIL: "Email",
  RECORDING: "Call recording",
  DATA_SHARING: "Data sharing",
};

const DECISION_TONE: Record<PolicyDecision["decision"], "success" | "danger" | "warning"> = {
  ALLOW: "success",
  DENY: "danger",
  DEFER: "warning",
};

export function ConsentTab({ consents, policyDecisions }: { consents: ConsentRecord[]; policyDecisions: PolicyDecision[] }) {
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>PolicyGate decisions</CardTitle>
            <CardDescription>Every compliance check run against this lead, most recent first — the actual reasons an attempt was allowed, blocked, or deferred.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className={policyDecisions.length === 0 ? "" : "divide-y divide-[var(--border)] p-0"}>
          {policyDecisions.length === 0 ? (
            <EmptyState icon={ShieldQuestion} title="No policy checks yet" description="Runs the first time outreach is attempted on this lead." />
          ) : (
            policyDecisions.map((d) => (
              <div key={d.id} className="px-5 py-3.5">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[13px] font-medium text-[var(--foreground)]">{d.channel}</p>
                  <div className="flex items-center gap-2">
                    <Badge tone={DECISION_TONE[d.decision]}>{d.decision}</Badge>
                    <span className="text-xs text-[var(--muted-foreground)]">{formatDateTime(d.evaluatedAt)}</span>
                  </div>
                </div>
                {d.reasons.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5">
                    {d.reasons.map((r) => (
                      <li key={r} className="text-xs text-[var(--muted-foreground)]">
                        · {RULE_DESCRIPTIONS[r] ?? r}
                      </li>
                    ))}
                  </ul>
                )}
                {d.nextPermittedAt && (
                  <p className="mt-1 text-xs text-[var(--muted-foreground)]">Next permitted at {formatDateTime(d.nextPermittedAt)}</p>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {consents.length === 0 ? (
        <EmptyState icon={CheckCircle2} title="No consent records" description="Consent is captured at intake and is immutable once written." />
      ) : (
        <div className="space-y-3">
          {consents.map((c) => (
            <Card key={c.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    {c.granted ? (
                      <CheckCircle2 className="h-4 w-4 text-[var(--success)]" />
                    ) : (
                      <XCircle className="h-4 w-4 text-[var(--danger)]" />
                    )}
                    <div>
                      <p className="text-[13px] font-medium text-[var(--foreground)]">{SCOPE_LABEL[c.scope]}</p>
                      <p className="text-xs text-[var(--muted-foreground)]">Captured {formatDateTime(c.capturedAt)}</p>
                    </div>
                  </div>
                  <Badge tone={c.granted ? "success" : "danger"}>{c.granted ? "Granted" : "Declined"}</Badge>
                </div>
                <details className="group mt-3">
                  <summary className="flex cursor-pointer list-none items-center gap-1 text-xs font-medium text-[var(--primary)]">
                    <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
                    View exact disclosure text ({c.disclosureVersionId})
                  </summary>
                  <p className="mt-2 rounded-[var(--radius-sm)] bg-[var(--background)] p-3 text-[13px] leading-relaxed text-[var(--muted)]">
                    {c.exactTextSnapshot}
                  </p>
                  <p className="mt-2 text-xs text-[var(--muted-foreground)]">
                    IP {c.ipAddress} · session {c.sessionId.slice(0, 12)}… · source {c.sourceUrl}
                  </p>
                </details>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
