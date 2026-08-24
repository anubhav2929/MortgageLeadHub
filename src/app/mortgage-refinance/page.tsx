import Link from "next/link";
import { GuidePage } from "@/components/marketing/guide-page";
import { SeoJsonLd } from "@/components/marketing/seo-json-ld";
import { articleJsonLd, breadcrumbJsonLd, seoMetadata } from "@/lib/seo";

const title = "Mortgage refinancing: how it works and what to compare";
const description = "Learn how mortgage refinancing replaces an existing loan, how to compare payment and total cost, and how to estimate your break-even period.";
export const metadata = seoMetadata({ title: `${title} | Equity Flow Group`, description, path: "/mortgage-refinance", keywords: ["mortgage refinancing", "should I refinance", "refinance closing costs", "refinance break-even"] });

export default function MortgageRefinancePage() {
  return <>
    <SeoJsonLd data={[articleJsonLd({ headline: title, description, path: "/mortgage-refinance" }), breadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "Mortgage resources", path: "/mortgage-resources" }, { name: "Mortgage refinancing", path: "/mortgage-refinance" }])]} />
    <GuidePage eyebrow="Mortgage refinance guide" title={title} summary="A mortgage refinance uses a new loan to pay off and replace your current mortgage. A useful comparison looks beyond the new payment to closing costs, loan term, interest paid over time, and how long you expect to keep the loan." takeaways={["A lower payment can come from a lower rate, a longer term, or both.", "Closing costs affect how long it takes to break even.", "Compare Loan Estimates for the same loan type and timeframe."]}>
      <section><h2>What does refinancing a mortgage mean?</h2><p>Refinancing replaces your current mortgage with a new mortgage. Homeowners may explore it to change the interest rate, monthly payment, loan term, loan type, or amount borrowed. The new loan has its own qualification, disclosures, and closing costs.</p></section>
      <section><h2>When can refinancing be worth exploring?</h2><p>Start with the outcome you want: a more manageable payment, a fixed rate, a shorter payoff timeline, or access to equity. Then compare the new loan against keeping the current one. A smaller monthly payment is not automatically a lower-cost loan if the repayment period restarts or becomes longer.</p></section>
      <section><h2>How to estimate the break-even point</h2><p>Divide the refinance costs you expect to pay by the estimated monthly savings. The result is a rough number of months needed to recover those costs. This shortcut does not capture every tax, opportunity-cost, or loan-term difference, so use it as a screening tool rather than a final decision.</p><p><Link href="/tools/refinance-calculator">Use the refinance calculator</Link> to compare principal-and-interest payments, then ask a licensed officer for a full cost comparison.</p></section>
      <section><h2>What to compare on a Loan Estimate</h2><ul className="list-disc space-y-2 pl-5"><li>Interest rate and whether it is locked.</li><li>APR, monthly principal and interest, mortgage insurance, and total payment.</li><li>Origination charges, lender credits, total closing costs, and cash to close.</li><li>The five-year cost comparison and whether the loan includes a prepayment penalty.</li></ul><p>For an independent walkthrough, review the <a href="https://www.consumerfinance.gov/owning-a-home/loan-estimate/" rel="noopener noreferrer">CFPB Loan Estimate explainer</a>.</p></section>
      <section><h2>Related decisions</h2><p>If your goal is to borrow against equity, compare a refinance with a second-lien product before replacing a favorable first mortgage. Read the <Link href="/home-equity-options">home equity options comparison</Link> or the <Link href="/cash-out-refinance">cash-out refinance guide</Link>.</p></section>
    </GuidePage>
  </>;
}
