import { ToolPageShell } from "@/components/marketing/tool-page-shell";
import { CashOutCalculator } from "@/components/marketing/tools/cash-out-calculator";
import { seoMetadata } from "@/lib/seo";

export const metadata = seoMetadata({
  title: "Cash-Out Refinance Calculator — Estimate Available Equity | Equity Flow Group",
  description:
    "Free cash-out refinance calculator. Enter your home value and mortgage balance to estimate how much cash you could access from your equity.",
  path: "/tools/cash-out-calculator",
  keywords: ["cash-out refinance calculator", "home equity calculator", "available equity estimate"],
});

export default function CashOutCalculatorPage() {
  return (
    <ToolPageShell
      eyebrow="Free calculator"
      title="Cash-out refinance calculator"
      description="Estimate how much of your home equity you could turn into cash with a new, larger mortgage."
    >
      <CashOutCalculator />
      <div className="mt-10 space-y-4 text-[14px] leading-relaxed text-[var(--mkt-body)]">
        <h2 className="text-[18px] font-semibold text-[var(--mkt-ink)]">How a cash-out refinance works</h2>
        <p>
          A cash-out refinance replaces your existing mortgage with a new, larger one, and you receive the
          difference in cash at closing. Lenders typically cap the new loan at a percentage of your home&apos;s
          value — often around 80% — so the amount you can access depends on your home&apos;s current value and how
          much you still owe.
        </p>
        <p>
          People use cash-out refinances for things like simplifying monthly payments, home improvements, or covering a large
          expense — but it does increase your loan balance and, usually, your monthly payment, so it&apos;s worth
          comparing against a home equity loan or line of credit before deciding.
        </p>
      </div>
    </ToolPageShell>
  );
}
