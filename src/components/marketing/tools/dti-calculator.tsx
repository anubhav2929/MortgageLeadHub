"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Scale, ArrowRight } from "lucide-react";
import { trackEvent } from "@/lib/analytics";

function assessment(backEndDti: number): { label: string; tone: string } {
  if (backEndDti <= 36) return { label: "Typically within standard guidelines", tone: "text-[var(--mkt-primary)]" };
  if (backEndDti <= 43) return { label: "Within range for many loan programs", tone: "text-[var(--mkt-ink)]" };
  if (backEndDti <= 50) return { label: "Above typical caps — some programs may still work", tone: "text-amber-700" };
  return { label: "Above most programs' limits", tone: "text-red-700" };
}

export function DtiCalculator() {
  const [income, setIncome] = useState("7500");
  const [housing, setHousing] = useState("2100");
  const [otherDebts, setOtherDebts] = useState("450");

  const result = useMemo(() => {
    const inc = Number(income);
    const h = Number(housing) || 0;
    const o = Number(otherDebts) || 0;
    if (!inc || inc <= 0) return null;
    const frontEnd = (h / inc) * 100;
    const backEnd = ((h + o) / inc) * 100;
    return { frontEnd, backEnd, ...assessment(backEnd) };
  }, [income, housing, otherDebts]);

  return (
    <div className="rounded-2xl border border-[var(--mkt-border)] bg-white p-6 shadow-[0_2px_8px_rgba(22,33,27,0.04),0_20px_48px_-24px_rgba(22,33,27,0.18)] sm:p-8">
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { id: "dti-income", label: "Gross monthly income", value: income, set: setIncome },
          { id: "dti-housing", label: "Housing payment (PITI)", value: housing, set: setHousing },
          { id: "dti-other", label: "Other monthly debts", value: otherDebts, set: setOtherDebts },
        ].map((f) => (
          <div key={f.id}>
            <label htmlFor={f.id} className="mb-1.5 block text-[12.5px] font-medium text-[var(--mkt-ink)]">{f.label}</label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-[var(--mkt-muted)]">$</span>
              <input
                id={f.id}
                type="text"
                inputMode="numeric"
                value={f.value ? Number(f.value.replace(/[^\d]/g, "")).toLocaleString("en-US") : ""}
                onChange={(e) => f.set(e.target.value.replace(/[^\d]/g, ""))}
                className="focus-ring h-11 w-full rounded-lg border border-[var(--mkt-border)] bg-white pl-6 pr-3 text-[14px] text-[var(--mkt-ink)]"
              />
            </div>
          </div>
        ))}
      </div>

      {result && (
        <div className="mt-6 border-t border-[var(--mkt-border)] pt-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-[12px] text-[var(--mkt-muted)]">Front-end DTI (housing only)</p>
              <p className="mt-0.5 text-[22px] font-semibold text-[var(--mkt-ink)]">{result.frontEnd.toFixed(1)}%</p>
            </div>
            <div>
              <p className="text-[12px] text-[var(--mkt-muted)]">Back-end DTI (all debts)</p>
              <p className="mt-0.5 text-[22px] font-semibold text-[var(--mkt-ink)]">{result.backEnd.toFixed(1)}%</p>
            </div>
          </div>
          <p className={`mt-4 text-[13.5px] font-medium ${result.tone}`}>{result.label}</p>
        </div>
      )}

      <div className="mt-6 flex flex-col items-center gap-3 border-t border-[var(--mkt-border)] pt-6 sm:flex-row sm:justify-between">
        <p className="flex items-start gap-1.5 text-[11.5px] leading-relaxed text-[var(--mkt-muted)]">
          <Scale className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          General guidance, not a lending decision — exact DTI limits vary by loan program, credit profile, and
          compensating factors like reserves or down payment.
        </p>
        <Link
          href="/apply"
          onClick={() => trackEvent("calculator_used")}
          className="flex w-full shrink-0 items-center justify-center gap-2 rounded-lg bg-[var(--mkt-primary)] px-5 py-3 text-[14px] font-semibold text-white transition-colors hover:bg-[var(--mkt-primary-hover)] sm:w-auto"
        >
          Check my options
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}
