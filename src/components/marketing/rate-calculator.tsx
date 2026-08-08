"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Calculator, ArrowRight } from "lucide-react";
import { trackEvent } from "@/lib/analytics";

// A representative example rate for today's market — NOT a quote or offer.
// Real pricing depends on credit, program, and lock date, which is exactly
// why the copy below is careful to call this an estimate, not a rate quote.
const EXAMPLE_MARKET_RATE = 6.35;

function monthlyPayment(balance: number, annualRatePct: number, years: number): number {
  const n = years * 12;
  const r = annualRatePct / 100 / 12;
  if (n <= 0) return 0;
  if (r === 0) return balance / n;
  return (balance * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
}

export function RateCalculator() {
  const [balance, setBalance] = useState("350000");
  const [rate, setRate] = useState("7.5");
  const [years, setYears] = useState("27");

  const result = useMemo(() => {
    const b = Number(balance);
    const r = Number(rate);
    const y = Number(years);
    if (!b || b <= 0 || !r || r <= 0 || !y || y <= 0) return null;
    const current = monthlyPayment(b, r, y);
    const estimated = monthlyPayment(b, EXAMPLE_MARKET_RATE, y);
    return { current, estimated, savings: current - estimated };
  }, [balance, rate, years]);

  return (
    <section className="border-t border-[var(--mkt-border)] bg-[var(--mkt-bg-alt)] py-16 sm:py-20">
      <div className="mx-auto max-w-3xl px-6">
        <div className="text-center">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-[var(--mkt-primary)]">See it before you share anything</p>
          <h2 className="mkt-balance mt-1.5 text-[28px] font-semibold tracking-tight text-[var(--mkt-ink)] sm:text-[32px]">
            What could refinancing save you?
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-[15px] leading-relaxed text-[var(--mkt-body)]">
            A quick, anonymous estimate — no name, phone, or email required. Adjust the numbers to match your loan.
          </p>
        </div>

        <div className="mt-8 rounded-2xl border border-[var(--mkt-border)] bg-white p-6 shadow-[0_2px_8px_rgba(22,33,27,0.04),0_20px_48px_-24px_rgba(22,33,27,0.18)] sm:p-8">
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="rc-balance" className="mb-1.5 block text-[12.5px] font-medium text-[var(--mkt-ink)]">Current loan balance</label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-[var(--mkt-muted)]">$</span>
                <input
                  id="rc-balance"
                  type="text"
                  inputMode="numeric"
                  value={balance ? Number(balance.replace(/[^\d]/g, "")).toLocaleString("en-US") : ""}
                  onChange={(e) => setBalance(e.target.value.replace(/[^\d]/g, ""))}
                  className="focus-ring h-11 w-full rounded-lg border border-[var(--mkt-border)] bg-white pl-6 pr-3 text-[14px] text-[var(--mkt-ink)]"
                />
              </div>
            </div>
            <div>
              <label htmlFor="rc-rate" className="mb-1.5 block text-[12.5px] font-medium text-[var(--mkt-ink)]">Current rate</label>
              <div className="relative">
                <input
                  id="rc-rate"
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
              <label htmlFor="rc-years" className="mb-1.5 block text-[12.5px] font-medium text-[var(--mkt-ink)]">Years remaining</label>
              <input
                id="rc-years"
                type="number"
                inputMode="numeric"
                value={years}
                onChange={(e) => setYears(e.target.value)}
                className="focus-ring h-11 w-full rounded-lg border border-[var(--mkt-border)] bg-white px-3 text-[14px] text-[var(--mkt-ink)]"
              />
            </div>
          </div>

          {result && (
            <div className="mt-6 grid gap-4 border-t border-[var(--mkt-border)] pt-6 sm:grid-cols-3">
              <div className="text-center sm:text-left">
                <p className="text-[12px] text-[var(--mkt-muted)]">Your payment now</p>
                <p className="mt-0.5 text-[22px] font-semibold text-[var(--mkt-ink)]">
                  ${Math.round(result.current).toLocaleString()}
                  <span className="text-[13px] font-normal text-[var(--mkt-muted)]">/mo</span>
                </p>
              </div>
              <div className="text-center sm:text-left">
                <p className="text-[12px] text-[var(--mkt-muted)]">At today&apos;s example rate ({EXAMPLE_MARKET_RATE}%)</p>
                <p className="mt-0.5 text-[22px] font-semibold text-[var(--mkt-ink)]">
                  ${Math.round(result.estimated).toLocaleString()}
                  <span className="text-[13px] font-normal text-[var(--mkt-muted)]">/mo</span>
                </p>
              </div>
              <div className="text-center sm:text-left">
                <p className="text-[12px] text-[var(--mkt-muted)]">Estimated monthly {result.savings >= 0 ? "savings" : "difference"}</p>
                <p className={`mt-0.5 text-[22px] font-semibold ${result.savings > 0 ? "text-[var(--mkt-primary)]" : "text-[var(--mkt-ink)]"}`}>
                  {result.savings >= 0 ? "" : "-"}${Math.abs(Math.round(result.savings)).toLocaleString()}
                  <span className="text-[13px] font-normal text-[var(--mkt-muted)]">/mo</span>
                </p>
              </div>
            </div>
          )}

          <div className="mt-6 flex flex-col items-center gap-3 border-t border-[var(--mkt-border)] pt-6 sm:flex-row sm:justify-between">
            <p className="flex items-start gap-1.5 text-[11.5px] leading-relaxed text-[var(--mkt-muted)]">
              <Calculator className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              An example, not a rate quote — principal &amp; interest only, doesn&apos;t include taxes, insurance, or
              closing costs. Your actual rate depends on credit, program, and when you lock.
            </p>
            <Link
              href="/apply"
              onClick={() => trackEvent("calculator_used", { savings: result ? Math.round(result.savings) : 0 })}
              className="flex w-full shrink-0 items-center justify-center gap-2 rounded-lg bg-[var(--mkt-primary)] px-5 py-3 text-[14px] font-semibold text-white transition-colors hover:bg-[var(--mkt-primary-hover)] sm:w-auto"
            >
              Get my real rate
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
