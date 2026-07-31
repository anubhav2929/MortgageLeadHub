import { Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FieldConflict } from "@/components/workspace/tabs/field-conflict";
import type { LeadField } from "@/domain/types";

// Keyed by the actual LeadField.fieldPath strings used in SECTIONS below —
// distinct from core/completeness.ts's COMPLETENESS_FIELD_LABELS, which is
// keyed by CompletenessInputs' shorthand names (e.g. "intent", not
// "loan.intent") and doesn't line up with these paths.
const FIELD_PATH_LABELS: Record<string, string> = {
  "contact.reachable": "Contactable",
  "borrower.incomeBand": "Income band",
  "property.identified": "Property identified",
  "property.occupancy": "Occupancy stated",
  "loan.intent": "Loan intent",
  "loan.purpose": "Loan purpose",
  "borrower.timeline": "Timeline",
  "borrower.creditBand": "Credit band",
};

const STATUS_TONE: Record<LeadField["status"], "neutral" | "primary" | "success" | "warning" | "danger"> = {
  UNKNOWN: "neutral",
  CANDIDATE: "warning",
  CONFIRMED: "primary",
  VERIFIED: "success",
  CONFLICTED: "danger",
};

const SECTIONS: { title: string; fields: string[] }[] = [
  { title: "1a · Borrower information", fields: ["contact.reachable"] },
  { title: "1b · Employment (presence/absence only)", fields: ["borrower.incomeBand"] },
  { title: "3 · Property & loan", fields: ["property.identified", "property.occupancy"] },
  { title: "4 · Loan & property info", fields: ["loan.intent", "loan.purpose", "borrower.timeline", "borrower.creditBand"] },
];

function displayValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v).replace(/_/g, " ");
}

export function PackageTab({ publicRef, fields }: { publicRef: string; fields: LeadField[] }) {
  const byPath = new Map(fields.map((f) => [f.fieldPath, f]));

  return (
    <div className="space-y-4">
      <div className="flex gap-2.5 rounded-[var(--radius-md)] border border-[var(--info-border)] bg-[var(--info-tint)] p-3.5 text-[13px] text-[var(--info)]">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          Pre-application summary. This is not a completed Form 1003, not an application, and not an approval.
          Two-year residence and employment history has not been collected and must be gathered by the loan
          officer.
        </p>
      </div>

      {SECTIONS.map((section) => (
        <Card key={section.title}>
          <CardHeader>
            <CardTitle>{section.title}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {section.fields.map((path) => {
              const f = byPath.get(path);
              const label = FIELD_PATH_LABELS[path] ?? path;
              if (!f) {
                return (
                  <div key={path} className="flex items-center justify-between border-b border-[var(--border)] pb-3 last:border-b-0 last:pb-0">
                    <span className="text-[13px] text-[var(--muted)]">{label}</span>
                    <Badge tone="neutral">UNKNOWN</Badge>
                  </div>
                );
              }
              return (
                <div key={path} className="border-b border-[var(--border)] pb-3 last:border-b-0 last:pb-0">
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] text-[var(--muted)]">{label}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium text-[var(--foreground)]">{displayValue(f.value)}</span>
                      <Badge tone={STATUS_TONE[f.status]}>{f.status}</Badge>
                    </div>
                  </div>
                  <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                    Source: {f.sourceType.replace("_", " ").toLowerCase()} · confidence {Math.round(f.confidence * 100)}%
                    {f.verificationStatus === "VERIFIED" ? " · verified" : ""}
                  </p>
                  {f.status === "CONFLICTED" && f.conflictingValue !== undefined && (
                    <div className="mt-2">
                      <FieldConflict
                        publicRef={publicRef}
                        fieldPath={path}
                        formValue={displayValue(f.value)}
                        conversationValue={displayValue(f.conflictingValue)}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardHeader>
          <CardTitle>5 · Declarations</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-[13px] text-[var(--muted)]">
          <div className="flex items-center justify-between">
            <span>Two-year residence history</span>
            <Badge tone="warning">NOT_COLLECTED</Badge>
          </div>
          <div className="flex items-center justify-between">
            <span>Two-year employment history</span>
            <Badge tone="warning">NOT_COLLECTED</Badge>
          </div>
          <div className="flex items-center justify-between">
            <span>Hardship indicators</span>
            <Badge tone="neutral">Skipped by borrower (allowed)</Badge>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
