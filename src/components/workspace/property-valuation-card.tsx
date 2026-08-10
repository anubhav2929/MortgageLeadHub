import { Home, Sparkles } from "lucide-react";
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
          Range ${valuation.confidenceLow.toLocaleString()} – ${valuation.confidenceHigh.toLocaleString()} · {valuation.comparableCount} comparable sales
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
              {valuation.propertyType.replace("_", " ").toLowerCase()} · built {valuation.yearBuilt}
              <Modeled valuation={valuation} field="yearBuilt" />
            </p>
          </div>
        </div>
        <p className="pt-1 text-[11px] text-[var(--muted-foreground)]">
          {valuation.simulated
            ? "Every figure here is modelled — no street address on file yet, or no AVM vendor connected. Set PROPERTY_DATA_API_KEY (RentCast) and collect a street address to go live."
            : `Valuation from RentCast. ${modeledCount} figure${modeledCount === 1 ? "" : "s"} marked "est" are modelled by us — no AVM vendor publishes outstanding mortgage balances, so balance, LTV, and equity are derived from an assumed LTV.`}
        </p>
      </CardContent>
    </Card>
  );
}
