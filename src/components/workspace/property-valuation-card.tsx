import { ExternalLink, Home, SearchCheck, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

export function PropertyValuationCard({ valuation }: { valuation: PropertyValuationResult }) {
  const modeledCount = Object.values(valuation.provenance).filter((p) => p === "MODELED").length;
  const evidence = valuation.evidence ?? [];
  if (valuation.method === "INSUFFICIENT_EVIDENCE") {
    return (
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-1.5"><Home className="h-3.5 w-3.5" /> Property valuation</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <p className="font-medium text-[var(--foreground)]">Insufficient evidence</p>
          <p className="text-xs text-[var(--muted-foreground)]">
            The Census-normalized public-record search, FHFA adjustment, and RentCast fallback did not produce two independent value sources. No simulated value was generated.
          </p>
          {evidence.length > 0 && <EvidenceList evidence={evidence} />}
          <p className="text-[11px] text-[var(--muted-foreground)]">{valuation.disclaimer}</p>
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
          {valuation.simulated && (
            <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
              <Sparkles className="h-3 w-3" /> Simulated
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
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
            <p className="text-[var(--muted-foreground)]">Est. mortgage balance</p>
            <p className="font-medium text-[var(--foreground)]">
              ${valuation.estimatedMortgageBalance.toLocaleString()}
              <Modeled valuation={valuation} field="estimatedMortgageBalance" />
            </p>
          </div>
          <div>
            <p className="text-[var(--muted-foreground)]">Usable equity</p>
            <p className="font-medium text-[var(--foreground)]">
              ${valuation.usableEquity.toLocaleString()}
              <Modeled valuation={valuation} field="usableEquity" />
            </p>
          </div>
          <div>
            <p className="text-[var(--muted-foreground)]">LTV</p>
            <p className="font-medium text-[var(--foreground)]">
              {valuation.estimatedLTV}%
              <Modeled valuation={valuation} field="estimatedLTV" />
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
        {evidence.length > 0 && <EvidenceList evidence={evidence} />}
      </CardContent>
    </Card>
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
