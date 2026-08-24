import { ToolPageShell } from "@/components/marketing/tool-page-shell";
import { DtiCalculator } from "@/components/marketing/tools/dti-calculator";
import { seoMetadata } from "@/lib/seo";

export const metadata = seoMetadata({
  title: "Debt-to-Income (DTI) Calculator for Mortgages | Equity Flow Group",
  description:
    "Free debt-to-income calculator for mortgage refinancing. Enter your income, housing payment, and other debts to see your front-end and back-end DTI.",
  path: "/tools/dti-calculator",
  keywords: ["debt-to-income calculator", "mortgage DTI calculator", "front-end DTI", "back-end DTI"],
});

export default function DtiCalculatorPage() {
  return (
    <ToolPageShell
      eyebrow="Free calculator"
      title="Debt-to-income (DTI) calculator"
      description="Lenders use your debt-to-income ratio to gauge how comfortably you can take on a mortgage payment. See where you stand."
    >
      <DtiCalculator />
      <div className="mt-10 space-y-4 text-[14px] leading-relaxed text-[var(--mkt-body)]">
        <h2 className="text-[18px] font-semibold text-[var(--mkt-ink)]">Front-end vs. back-end DTI</h2>
        <p>
          Front-end DTI only counts your housing payment (principal, interest, taxes, and insurance) against your
          gross monthly income. Back-end DTI adds in every other recurring debt — car payments, student loans,
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
