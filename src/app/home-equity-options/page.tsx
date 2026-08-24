import Link from "next/link";
import { GuidePage } from "@/components/marketing/guide-page";
import { SeoJsonLd } from "@/components/marketing/seo-json-ld";
import { articleJsonLd, breadcrumbJsonLd, seoMetadata } from "@/lib/seo";

const title = "Home equity options: cash-out refinance, loan, or HELOC?";
const description = "Compare cash-out refinancing, home equity loans, and HELOCs by loan structure, payment, rate type, costs, and access to funds.";
export const metadata = seoMetadata({ title: `${title} | Equity Flow Group`, description, path: "/home-equity-options", keywords: ["home equity options", "HELOC vs home equity loan", "cash-out refinance vs HELOC", "borrow home equity"] });

export default function HomeEquityOptionsPage() {
  return <>
    <SeoJsonLd data={[articleJsonLd({ headline: title, description, path: "/home-equity-options" }), breadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "Mortgage resources", path: "/mortgage-resources" }, { name: "Home equity options", path: "/home-equity-options" }])]} />
    <GuidePage eyebrow="Product comparison" title={title} summary="The main home-equity borrowing choices differ in a fundamental way: a cash-out refinance replaces the first mortgage, while a home equity loan or line of credit is generally an additional loan secured by the home." takeaways={["Cash-out refinance replaces the existing mortgage.", "A home equity loan generally provides a lump sum with a separate payment.", "A HELOC generally allows repeated draws and often has a variable rate."]}>
      <section><h2>Quick comparison</h2><div className="overflow-x-auto"><table className="w-full border-collapse text-left text-sm"><thead><tr className="border-b border-[var(--mkt-border)]"><th className="p-3">Option</th><th className="p-3">Loan structure</th><th className="p-3">Access to funds</th><th className="p-3">Key comparison</th></tr></thead><tbody><tr className="border-b border-[var(--mkt-border)]"><th className="p-3">Cash-out refinance</th><td className="p-3">Replaces first mortgage</td><td className="p-3">Lump sum at closing</td><td className="p-3">New terms apply to the full mortgage balance</td></tr><tr className="border-b border-[var(--mkt-border)]"><th className="p-3">Home equity loan</th><td className="p-3">Separate secured loan</td><td className="p-3">Lump sum</td><td className="p-3">Usually a distinct payment and fixed repayment schedule</td></tr><tr><th className="p-3">HELOC</th><td className="p-3">Separate revolving line</td><td className="p-3">Draw as needed during the draw period</td><td className="p-3">Often variable-rate, with payment changes over time</td></tr></tbody></table></div></section>
      <section><h2>Questions to ask before choosing</h2><ul className="list-disc space-y-2 pl-5"><li>Do you need one lump sum or flexibility to draw over time?</li><li>Would replacing your current first-mortgage terms help or hurt?</li><li>Can the payment change, and what would a higher payment mean for your budget?</li><li>What are the upfront costs, annual fees, draw requirements, and early-closure terms?</li><li>How much total interest could you pay over the expected time you keep the loan?</li></ul></section>
      <section><h2>Estimate, then verify</h2><p>Use the <Link href="/tools/cash-out-calculator">cash-out calculator</Link> for a preliminary range and the <Link href="/tools/dti-calculator">DTI calculator</Link> to organize monthly obligations. A licensed lender must verify property value, eligibility, and final terms.</p></section>
      <section><h2>Read official comparisons</h2><p>The <a href="https://www.consumerfinance.gov/consumer-tools/mortgages/" rel="noopener noreferrer">Consumer Financial Protection Bureau</a> publishes independent mortgage and home-equity materials. Use those resources alongside product disclosures and comparable Loan Estimates.</p></section>
    </GuidePage>
  </>;
}
