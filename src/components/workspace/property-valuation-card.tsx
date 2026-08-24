"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, ExternalLink, Home, RefreshCw, SearchCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { rerunPropertyValuationAction } from "@/domain/actions";
import type { PropertyClarification } from "@/core/propertyValuationQuality";
import type { PropertyValuationField, PropertyValuationResult } from "@/domain/types";
import { formatDate } from "@/lib/utils";

/** Marks a number the vendor did not supply. The balance/LTV/equity trio is
 *  always derived from an assumed LTV — even when the valuation itself came
 *  back live — so an officer must not repeat these to a borrower as fact. */
function Modeled({ valuation, field }: { valuation: PropertyValuationResult; field: PropertyValuationField }) {
  if (valuation.provenance[field] !== "MODELED") return null;
  return (
    <span
      title="Estimated by us, not reported by the data provider — do not quote to the borrower."
      className="ml-1 align-middle text-[9px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]"
    >
      est
    </span>
  );
}

export function PropertyValuationCard({
  valuation,
  publicRef,
  canRerun,
  clarifications,
}: {
  valuation: PropertyValuationResult;
  publicRef: string;
  canRerun: boolean;
  clarifications: PropertyClarification[];
}) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const { push } = useToast();
  const modeledCount = Object.values(valuation.provenance).filter((p) => p === "MODELED").length;
  const evidence = valuation.evidence ?? [];
  const unsupported = valuation.method === "INSUFFICIENT_EVIDENCE" || valuation.method === "SIMULATED" || valuation.simulated;
  const hasReportedBalance = valuation.provenance.estimatedMortgageBalance !== "MODELED";

  function rerun() {
    startTransition(async () => {
      const result = await rerunPropertyValuationAction(publicRef);
      push({ title: result.message, tone: result.ok ? "success" : "danger" });
      if (result.ok) router.refresh();
    });
  }

  const controls = canRerun ? (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] pt-3">
      <p className="text-[11px] text-[var(--muted-foreground)]">Admin check · audited and saved to this lead</p>
      <Button variant="secondary" size="sm" loading={isPending} onClick={rerun}>
        {!isPending && <RefreshCw className="h-3.5 w-3.5" />}
        {isPending ? "Rechecking property data…" : "Run checks again"}
      </Button>
    </div>
  ) : null;

  if (unsupported) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5"><Home className="h-3.5 w-3.5" /> Property valuation</CardTitle>
          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--warning-tint)] px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--warning)]">
            <AlertCircle className="h-3 w-3" /> Needs details
          </span>
        </CardHeader>
        <CardContent className="space-y-3" aria-busy={isPending}>
          {isPending && (
            <div role="status" aria-live="polite" className="rounded-[var(--radius-md)] border border-[var(--info-border)] bg-[var(--info-tint)] p-3 text-xs text-[var(--info)]">
              Rechecking Census normalization, approved public records, FHFA adjustments, and the RentCast fallback…
            </div>
          )}
          <p className="font-medium text-[var(--foreground)]">No supported value is available yet</p>
          <p className="text-xs text-[var(--muted-foreground)]">
            The available sources did not produce enough independent evidence. No simulated or modeled-only dollar value is shown or used as verified property data.
          </p>
          <ClarificationList clarifications={clarifications} />
          {evidence.length > 0 && <EvidenceList evidence={evidence} />}
          <p className="text-[11px] text-[var(--muted-foreground)]">{valuation.disclaimer}</p>
          {controls}
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-1.5">
            <Home className="h-3.5 w-3.5" /> Property valuation
          </CardTitle>
          <span className="flex items-center gap-1 rounded-full bg-[var(--success-tint)] px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--success)]">
            <CheckCircle2 className="h-3 w-3" /> {valuation.method === "RENTCAST" ? "Provider estimate" : "Public evidence"}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-2" aria-busy={isPending}>
        {isPending && (
          <div role="status" aria-live="polite" className="rounded-[var(--radius-md)] border border-[var(--info-border)] bg-[var(--info-tint)] p-3 text-xs text-[var(--info)]">
            Rechecking property evidence and calculating the updated value range…
          </div>
        )}
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-semibold text-[var(--foreground)]">${valuation.estimatedValue.toLocaleString()}</span>
        </div>
        <p className="text-xs text-[var(--muted-foreground)]">
          Range ${valuation.confidenceLow.toLocaleString()} – ${valuation.confidenceHigh.toLocaleString()} · {valuation.comparableCount} independent value source{valuation.comparableCount === 1 ? "" : "s"}
        </p>
        {valuation.lastSalePrice && valuation.lastSaleDate && (
          <p className="text-xs text-[var(--muted-foreground)]">
            Last sale: ${valuation.lastSalePrice.toLocaleString()} on {formatDate(valuation.lastSaleDate)}
          </p>
        )}
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-[var(--border)] pt-2.5 text-xs">
          <div>
            <p className="text-[var(--muted-foreground)]">Reported mortgage balance</p>
            <p className="font-medium text-[var(--foreground)]">
              {hasReportedBalance ? `$${valuation.estimatedMortgageBalance.toLocaleString()}` : "Not collected"}
            </p>
          </div>
          <div>
            <p className="text-[var(--muted-foreground)]">Calculated equity</p>
            <p className="font-medium text-[var(--foreground)]">
              {hasReportedBalance ? `$${valuation.usableEquity.toLocaleString()}` : "Needs balance"}
              {hasReportedBalance && <Modeled valuation={valuation} field="usableEquity" />}
            </p>
          </div>
          <div>
            <p className="text-[var(--muted-foreground)]">LTV</p>
            <p className="font-medium text-[var(--foreground)]">
              {hasReportedBalance ? `${valuation.estimatedLTV}%` : "Needs balance"}
              {hasReportedBalance && <Modeled valuation={valuation} field="estimatedLTV" />}
            </p>
          </div>
          <div>
            <p className="text-[var(--muted-foreground)]">Property</p>
            <p className="font-medium text-[var(--foreground)]">
              {valuation.propertyType.replace("_", " ").toLowerCase()} · built {valuation.yearBuilt > 0 ? valuation.yearBuilt : "unknown"}
              <Modeled valuation={valuation} field="yearBuilt" />
            </p>
          </div>
        </div>
        <p className="pt-1 text-[11px] text-[var(--muted-foreground)]">
          {valuation.method === "OPEN_EVIDENCE"
            ? `Deterministically weighted approved evidence (${valuation.confidence?.toLowerCase()} confidence). ${modeledCount} field${modeledCount === 1 ? "" : "s"} marked "est" were derived rather than supplied by a source.`
            : `Valuation from RentCast. ${modeledCount} field${modeledCount === 1 ? "" : "s"} marked "est" were derived rather than supplied by the provider.`}
        </p>
        {valuation.disclaimer && <p className="text-[11px] text-[var(--muted-foreground)]">{valuation.disclaimer}</p>}
        {valuation.freshnessAt && <p className="text-[10px] text-[var(--muted-foreground)]">Last checked {formatDate(valuation.freshnessAt)}</p>}
        <ClarificationList clarifications={clarifications} />
        {evidence.length > 0 && <EvidenceList evidence={evidence} />}
        {controls}
      </CardContent>
    </Card>
  );
}

function ClarificationList({ clarifications }: { clarifications: PropertyClarification[] }) {
  if (clarifications.length === 0) return null;
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--warning-border)] bg-[var(--warning-tint)] p-3">
      <p className="text-xs font-semibold text-[var(--foreground)]">Clarify before relying on this value</p>
      <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">Ask the borrower, then use Edit above and rerun the checks.</p>
      <ul className="mt-2 space-y-2">
        {clarifications.map((item) => (
          <li key={item.id} className="text-xs leading-relaxed text-[var(--foreground)]">
            <span className="font-medium">{item.question}</span>
            <span className="block text-[11px] text-[var(--muted-foreground)]">{item.reason}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EvidenceList({ evidence }: { evidence: NonNullable<PropertyValuationResult["evidence"]> }) {
  return (
    <details className="group border-t border-[var(--border)] pt-2.5">
      <summary className="focus-ring flex cursor-pointer list-none items-center gap-1.5 rounded text-xs font-medium text-[var(--foreground)]">
        <SearchCheck className="h-3.5 w-3.5 text-[var(--primary)]" />
        Evidence & methodology ({evidence.length})
      </summary>
      <div className="mt-2 space-y-2">
        {evidence.map((item) => (
          <div key={item.id} className="rounded-[var(--radius-md)] bg-[var(--background)] p-2 text-[11px]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              {item.sourceUrl ? (
                <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-[var(--foreground)] hover:text-[var(--primary)]">
                  {item.sourceLabel}<ExternalLink className="h-3 w-3" />
                </a>
              ) : <span className="font-medium text-[var(--foreground)]">{item.sourceLabel}</span>}
              <span className="text-[var(--muted-foreground)]">{Math.round(item.reliability * 100)}% evidence weight</span>
            </div>
            <p className="mt-0.5 text-[var(--muted-foreground)]">
              {item.kind.replaceAll("_", " ").toLowerCase()}
              {item.value ? ` · $${item.value.toLocaleString()}` : " · address/fact verification only"}
              {item.observedAt ? ` · observed ${formatDate(item.observedAt)}` : ""}
            </p>
            {item.notes && <p className="mt-0.5 text-[var(--muted-foreground)]">{item.notes}</p>}
          </div>
        ))}
        <p className="text-[10px] leading-relaxed text-[var(--muted-foreground)]">
          Search ranks configured official sources; it never supplies the dollar value. Values are extracted from allowlisted JSON/ArcGIS public records, time-adjusted with FHFA where possible, and weighted deterministically.
        </p>
      </div>
    </details>
  );
}
