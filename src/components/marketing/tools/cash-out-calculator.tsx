"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Wallet, ArrowRight } from "lucide-react";
import { trackEvent } from "@/lib/analytics";

const TYPICAL_MAX_LTV = 80;

function CurrencyField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[12.5px] font-medium text-[var(--mkt-ink)]">{label}</label>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-[var(--mkt-muted)]">$</span>
        <input
          id={id}
          type="text"
          inputMode="numeric"
          value={value ? Number(value.replace(/[^\d]/g, "")).toLocaleString("en-US") : ""}
          onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, ""))}
          className="focus-ring h-11 w-full rounded-lg border border-[var(--mkt-border)] bg-white pl-6 pr-3 text-[14px] text-[var(--mkt-ink)]"
        />
      </div>
    </div>
  );
}

export function CashOutCalculator() {
  const [homeValue, setHomeValue] = useState("450000");
  const [balance, setBalance] = useState("220000");

  const result = useMemo(() => {
    const v = Number(homeValue);
    const b = Number(balance);
    if (!v || v <= 0 || !b || b < 0) return null;
    const maxLoanAmount = v * (TYPICAL_MAX_LTV / 100);
    const cashOut = Math.max(0, maxLoanAmount - b);
    const currentLtv = (b / v) * 100;
    return { cashOut, maxLoanAmount, currentLtv };
  }, [homeValue, balance]);

  return (
    <div className="rounded-2xl border border-[var(--mkt-border)] bg-white p-6 shadow-[0_2px_8px_rgba(22,33,27,0.04),0_20px_48px_-24px_rgba(22,33,27,0.18)] sm:p-8">
      <div className="grid gap-4 sm:grid-cols-2">
        <CurrencyField id="coc-home-value" label="Estimated home value" value={homeValue} onChange={setHomeValue} />
        <CurrencyField id="coc-balance" label="Current mortgage balance" value={balance} onChange={setBalance} />
      </div>

      {result && (
        <div className="mt-6 grid gap-4 border-t border-[var(--mkt-border)] pt-6 sm:grid-cols-2">
          <div>
            <p className="text-[12px] text-[var(--mkt-muted)]">Current loan-to-value</p>
            <p className="mt-0.5 text-[22px] font-semibold text-[var(--mkt-ink)]">{result.currentLtv.toFixed(0)}%</p>
          </div>
          <div>
            <p className="text-[12px] text-[var(--mkt-muted)]">Potential cash available (at {TYPICAL_MAX_LTV}% max LTV)</p>
            <p className="mt-0.5 text-[22px] font-semibold text-[var(--mkt-primary)]">${Math.round(result.cashOut).toLocaleString()}</p>
          </div>
        </div>
      )}

      <div className="mt-6 flex flex-col items-center gap-3 border-t border-[var(--mkt-border)] pt-6 sm:flex-row sm:justify-between">
        <p className="flex items-start gap-1.5 text-[11.5px] leading-relaxed text-[var(--mkt-muted)]">
          <Wallet className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          An example, not an offer — actual available equity depends on an appraisal, your credit, and the loan
          program&apos;s specific LTV limit, which can be lower or higher than {TYPICAL_MAX_LTV}%.
        </p>
        <Link
          href="/apply"
          onClick={() => trackEvent("calculator_used")}
          className="flex w-full shrink-0 items-center justify-center gap-2 rounded-lg bg-[var(--mkt-primary)] px-5 py-3 text-[14px] font-semibold text-white transition-colors hover:bg-[var(--mkt-primary-hover)] sm:w-auto"
        >
          See my real number
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}
