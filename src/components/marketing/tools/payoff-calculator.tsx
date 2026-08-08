"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Clock, ArrowRight } from "lucide-react";
import { trackEvent } from "@/lib/analytics";

/** Months to pay off `balance` at monthly payment `payment` and monthly
 *  rate `r`. Returns null if the payment never covers the interest. */
function monthsToPayoff(balance: number, r: number, payment: number): number | null {
  if (r === 0) return payment > 0 ? Math.ceil(balance / payment) : null;
  if (payment <= balance * r) return null;
  return Math.ceil(Math.log(payment / (payment - balance * r)) / Math.log(1 + r));
}

function totalInterest(balance: number, r: number, payment: number, months: number): number {
  let remaining = balance;
  let interest = 0;
  for (let i = 0; i < months && remaining > 0; i++) {
    const interestThisMonth = remaining * r;
    interest += interestThisMonth;
    remaining = remaining + interestThisMonth - payment;
  }
  return interest;
}

function monthlyPayment(balance: number, annualRatePct: number, years: number): number {
  const n = years * 12;
  const r = annualRatePct / 100 / 12;
  if (n <= 0) return 0;
  if (r === 0) return balance / n;
  return (balance * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
}

export function PayoffCalculator() {
  const [balance, setBalance] = useState("300000");
  const [rate, setRate] = useState("6.5");
  const [years, setYears] = useState("25");
  const [extra, setExtra] = useState("200");

  const result = useMemo(() => {
    const b = Number(balance);
    const r = Number(rate) / 100 / 12;
    const y = Number(years);
    const e = Number(extra) || 0;
    if (!b || b <= 0 || !r || r <= 0 || !y || y <= 0) return null;

    const basePayment = monthlyPayment(b, Number(rate), y);
    const baseMonths = y * 12;
    const withExtraMonths = monthsToPayoff(b, r, basePayment + e);
    if (withExtraMonths === null) return null;

    const baseInterest = totalInterest(b, r, basePayment, baseMonths);
    const extraInterest = totalInterest(b, r, basePayment + e, withExtraMonths);

    return {
      basePayment,
      baseMonths,
      withExtraMonths,
      monthsSaved: baseMonths - withExtraMonths,
      interestSaved: baseInterest - extraInterest,
    };
  }, [balance, rate, years, extra]);

  return (
    <div className="rounded-2xl border border-[var(--mkt-border)] bg-white p-6 shadow-[0_2px_8px_rgba(22,33,27,0.04),0_20px_48px_-24px_rgba(22,33,27,0.18)] sm:p-8">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="poc-balance" className="mb-1.5 block text-[12.5px] font-medium text-[var(--mkt-ink)]">Remaining balance</label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-[var(--mkt-muted)]">$</span>
            <input
              id="poc-balance"
              type="text"
              inputMode="numeric"
              value={balance ? Number(balance.replace(/[^\d]/g, "")).toLocaleString("en-US") : ""}
              onChange={(e) => setBalance(e.target.value.replace(/[^\d]/g, ""))}
              className="focus-ring h-11 w-full rounded-lg border border-[var(--mkt-border)] bg-white pl-6 pr-3 text-[14px] text-[var(--mkt-ink)]"
            />
          </div>
        </div>
        <div>
          <label htmlFor="poc-rate" className="mb-1.5 block text-[12.5px] font-medium text-[var(--mkt-ink)]">Interest rate</label>
          <div className="relative">
            <input
              id="poc-rate"
              type="number"
              inputMode="decimal"
              step="0.01"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              className="focus-ring h-11 w-full rounded-lg border border-[var(--mkt-border)] bg-white pl-3 pr-7 text-[14px] text-[var(--mkt-ink)]"
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[14px] text-[var(--mkt-muted)]">%</span>
          </div>
        </div>
        <div>
          <label htmlFor="poc-years" className="mb-1.5 block text-[12.5px] font-medium text-[var(--mkt-ink)]">Years remaining</label>
          <input
            id="poc-years"
            type="number"
            inputMode="numeric"
            value={years}
            onChange={(e) => setYears(e.target.value)}
            className="focus-ring h-11 w-full rounded-lg border border-[var(--mkt-border)] bg-white px-3 text-[14px] text-[var(--mkt-ink)]"
          />
        </div>
        <div>
          <label htmlFor="poc-extra" className="mb-1.5 block text-[12.5px] font-medium text-[var(--mkt-ink)]">Extra payment / month</label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-[var(--mkt-muted)]">$</span>
            <input
              id="poc-extra"
              type="text"
              inputMode="numeric"
              value={extra ? Number(extra.replace(/[^\d]/g, "")).toLocaleString("en-US") : ""}
              onChange={(e) => setExtra(e.target.value.replace(/[^\d]/g, ""))}
              className="focus-ring h-11 w-full rounded-lg border border-[var(--mkt-border)] bg-white pl-6 pr-3 text-[14px] text-[var(--mkt-ink)]"
            />
          </div>
        </div>
      </div>

      {result && (
        <div className="mt-6 grid gap-4 border-t border-[var(--mkt-border)] pt-6 sm:grid-cols-2">
          <div>
            <p className="text-[12px] text-[var(--mkt-muted)]">Payoff time saved</p>
            <p className="mt-0.5 text-[22px] font-semibold text-[var(--mkt-primary)]">
              {Math.floor(result.monthsSaved / 12)}y {result.monthsSaved % 12}m
            </p>
          </div>
          <div>
            <p className="text-[12px] text-[var(--mkt-muted)]">Interest saved</p>
            <p className="mt-0.5 text-[22px] font-semibold text-[var(--mkt-primary)]">${Math.round(result.interestSaved).toLocaleString()}</p>
          </div>
        </div>
      )}

      <div className="mt-6 flex flex-col items-center gap-3 border-t border-[var(--mkt-border)] pt-6 sm:flex-row sm:justify-between">
        <p className="flex items-start gap-1.5 text-[11.5px] leading-relaxed text-[var(--mkt-muted)]">
          <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          An example — assumes a fixed rate and doesn&apos;t include taxes, insurance, or prepayment penalties. Check
          your loan terms allow extra principal payments with no penalty.
        </p>
        <Link
          href="/apply"
          onClick={() => trackEvent("calculator_used", { savings: result ? Math.round(result.interestSaved) : 0 })}
          className="flex w-full shrink-0 items-center justify-center gap-2 rounded-lg bg-[var(--mkt-primary)] px-5 py-3 text-[14px] font-semibold text-white transition-colors hover:bg-[var(--mkt-primary-hover)] sm:w-auto"
        >
          Talk to a loan officer
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}
