import { ToolPageShell } from "@/components/marketing/tool-page-shell";
import { PayoffCalculator } from "@/components/marketing/tools/payoff-calculator";
import { seoMetadata } from "@/lib/seo";

export const metadata = seoMetadata({
  title: "Mortgage Payoff Calculator — Extra Payment Savings | Equity Flow Group",
  description:
    "Free mortgage payoff calculator. See how much time and interest an extra monthly payment could save you over the life of your loan.",
  path: "/tools/mortgage-payoff-calculator",
  keywords: ["mortgage payoff calculator", "extra mortgage payment calculator", "mortgage interest savings"],
});

export default function PayoffCalculatorPage() {
  return (
    <ToolPageShell
      eyebrow="Free calculator"
      title="Mortgage payoff calculator"
      description="See how much faster you could pay off your mortgage — and how much interest you could save — with an extra monthly payment."
    >
      <PayoffCalculator />
      <div className="mt-10 space-y-4 text-[14px] leading-relaxed text-[var(--mkt-body)]">
        <h2 className="text-[18px] font-semibold text-[var(--mkt-ink)]">How extra payments help</h2>
        <p>
          Every extra dollar you put toward principal reduces the balance that future interest is calculated on,
          which compounds over the life of the loan — even a modest extra payment each month can shave years off a
          30-year mortgage and save a meaningful amount in interest.
        </p>
        <p>
          Before making extra payments, confirm with your loan servicer that there&apos;s no prepayment penalty and
          that extra payments are applied to principal, not held as a credit toward your next regular payment.
        </p>
      </div>
    </ToolPageShell>
  );
}
