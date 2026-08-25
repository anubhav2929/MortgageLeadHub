import { ToolPageShell } from "@/components/marketing/tool-page-shell";
import { DtiCalculator } from "@/components/marketing/tools/dti-calculator";
import { seoMetadata } from "@/lib/seo";

export const metadata = seoMetadata({
  title: "Mortgage DTI Calculator | Equity Flow Group",
  description:
    "Free mortgage DTI calculator. Enter your income, housing payment, and other monthly obligations to see your front-end and back-end ratios.",
  path: "/tools/dti-calculator",
  keywords: ["mortgage DTI calculator", "monthly payment ratio", "front-end DTI", "back-end DTI"],
});

export default function DtiCalculatorPage() {
  return (
    <ToolPageShell
      eyebrow="Free calculator"
      title="Mortgage DTI calculator"
      description="Lenders use DTI to gauge how comfortably you can take on a mortgage payment. See where you stand."
    >
      <DtiCalculator />
      <div className="mt-10 space-y-4 text-[14px] leading-relaxed text-[var(--mkt-body)]">
        <h2 className="text-[18px] font-semibold text-[var(--mkt-ink)]">Front-end vs. back-end DTI</h2>
        <p>
          Front-end DTI only counts your housing payment (principal, interest, taxes, and insurance) against your
          gross monthly income. Back-end DTI adds every other recurring obligation — car payments, student loans,
          minimum credit card payments — for a fuller picture of your monthly obligations.
        </p>
        <p>
          Most conventional loan programs look for a back-end DTI at or below 43-45%, though some programs allow
          higher ratios with strong compensating factors like a large down payment, significant cash reserves, or
          excellent credit.
        </p>
      </div>
    </ToolPageShell>
  );
}
