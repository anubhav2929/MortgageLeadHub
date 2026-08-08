"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Home, RefreshCw, Wallet, ShieldCheck } from "lucide-react";
import { STATE_NAMES } from "@/domain/stateTimezone";

const PURPOSES = [
  { value: "REFINANCE", label: "Lower my rate", icon: RefreshCw },
  { value: "CASH_OUT", label: "Cash-out refi", icon: Wallet },
  { value: "HOME_EQUITY", label: "Home equity", icon: Home },
] as const;

export function QuickStartForm() {
  const router = useRouter();
  const [purpose, setPurpose] = useState<(typeof PURPOSES)[number]["value"]>("REFINANCE");
  const [stateCode, setStateCode] = useState("");
  const [homeValue, setHomeValue] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams({ intent: purpose });
    if (stateCode) params.set("stateCode", stateCode);
    if (homeValue) params.set("estimatedValue", homeValue);
    router.push(`/apply?${params.toString()}`);
  }

  return (
    <form
      onSubmit={submit}
      className="w-full max-w-md rounded-2xl border border-[var(--mkt-border)] bg-[var(--mkt-card)] p-6 shadow-[0_2px_8px_rgba(22,33,27,0.04),0_20px_48px_-24px_rgba(22,33,27,0.18)] sm:p-7"
    >
      <p className="text-[13px] font-medium text-[var(--mkt-muted)]">See your options in about 2 minutes</p>
      <h2 className="mkt-balance mt-1.5 text-[21px] font-semibold leading-snug text-[var(--mkt-ink)]">
        What are you hoping to do?
      </h2>

      <div className="mt-5 grid grid-cols-3 gap-2">
        {PURPOSES.map((p) => {
          const active = purpose === p.value;
          return (
            <button
              key={p.value}
              type="button"
              onClick={() => setPurpose(p.value)}
              className={`flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3.5 text-center transition-colors ${
                active
                  ? "border-[var(--mkt-primary)] bg-[var(--mkt-primary-tint)]"
                  : "border-[var(--mkt-border)] bg-white hover:border-[var(--mkt-muted)]"
              }`}
            >
              <p.icon className={`h-4.5 w-4.5 ${active ? "text-[var(--mkt-primary)]" : "text-[var(--mkt-muted)]"}`} />
              <span className={`text-[12px] font-medium leading-tight ${active ? "text-[var(--mkt-primary-ink)]" : "text-[var(--mkt-ink)]"}`}>
                {p.label}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="qsf-state" className="mb-1.5 block text-[12.5px] font-medium text-[var(--mkt-ink)]">Property state</label>
          <select
            id="qsf-state"
            value={stateCode}
            onChange={(e) => setStateCode(e.target.value)}
            className="focus-ring h-11 w-full rounded-lg border border-[var(--mkt-border)] bg-white px-3 text-[14px] text-[var(--mkt-ink)]"
          >
            <option value="">Select</option>
            {Object.entries(STATE_NAMES).map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="qsf-home-value" className="mb-1.5 block text-[12.5px] font-medium text-[var(--mkt-ink)]">Est. home value</label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-[var(--mkt-muted)]">$</span>
            <input
              id="qsf-home-value"
              type="text"
              inputMode="numeric"
              value={homeValue ? Number(homeValue).toLocaleString("en-US") : ""}
              onChange={(e) => setHomeValue(e.target.value.replace(/[^\d]/g, ""))}
              placeholder="450,000"
              className="focus-ring h-11 w-full rounded-lg border border-[var(--mkt-border)] bg-white pl-6 pr-3 text-[14px] text-[var(--mkt-ink)] placeholder:text-[var(--mkt-muted)]"
            />
          </div>
        </div>
      </div>

      <button
        type="submit"
        className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--mkt-primary)] py-3.5 text-[15px] font-semibold text-white transition-colors hover:bg-[var(--mkt-primary-hover)]"
      >
        See my options
        <ArrowRight className="h-4 w-4" />
      </button>

      <p className="mt-3.5 flex items-center justify-center gap-1.5 text-center text-[11.5px] text-[var(--mkt-muted)]">
        <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
        This won&apos;t affect your credit score. No obligation.
      </p>
    </form>
  );
}
