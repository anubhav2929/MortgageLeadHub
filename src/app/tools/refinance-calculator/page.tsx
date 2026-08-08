import type { Metadata } from "next";
import { ToolPageShell } from "@/components/marketing/tool-page-shell";
import { RateCalculator } from "@/components/marketing/rate-calculator";

export const metadata: Metadata = {
  title: "Refinance Calculator — Estimate Your New Monthly Payment | Equity Flow Group",
  description:
    "Free refinance calculator. Enter your current balance, rate, and remaining term to estimate what refinancing could save you per month.",
};

export default function RefinanceCalculatorPage() {
  return (
    <ToolPageShell
      eyebrow="Free calculator"
      title="Refinance calculator"
      description="See what refinancing your current mortgage could do to your monthly payment — no name, phone, or email required."
    >
      <RateCalculator />
      <div className="mt-10 space-y-4 text-[14px] leading-relaxed text-[var(--mkt-body)]">
        <h2 className="text-[18px] font-semibold text-[var(--mkt-ink)]">How this estimate works</h2>
        <p>
          This calculator compares the principal-and-interest payment on your current loan balance and rate against
          an example rate at today&apos;s market, using a standard amortization formula. It doesn&apos;t include
          property taxes, homeowners insurance, HOA dues, or closing costs — your actual new payment will depend on
          those, plus the specific program and rate you lock with a lender.
        </p>
        <p>
          Refinancing generally makes the most sense when the new rate is meaningfully lower than your current one,
          when you plan to stay in the home long enough to recoup closing costs, or when you want to switch loan
          types (like moving from an ARM to a fixed rate) or shorten your term.
        </p>
      </div>
    </ToolPageShell>
  );
}
