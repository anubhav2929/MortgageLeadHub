import Link from "next/link";
import { GuidePage } from "@/components/marketing/guide-page";
import { SeoJsonLd } from "@/components/marketing/seo-json-ld";
import { articleJsonLd, breadcrumbJsonLd, seoMetadata } from "@/lib/seo";

const title = "Cash-out refinance: uses, costs, and alternatives";
const description = "Understand how a cash-out refinance converts part of home equity into cash, what it changes, and how it compares with home equity loans and HELOCs.";
export const metadata = seoMetadata({ title: `${title} | Equity Flow Group`, description, path: "/cash-out-refinance", keywords: ["cash-out refinance", "cash out home equity", "cash-out refinance calculator", "cash-out refinance alternatives"] });

export default function CashOutRefinancePage() {
  return <>
    <SeoJsonLd data={[articleJsonLd({ headline: title, description, path: "/cash-out-refinance" }), breadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "Mortgage resources", path: "/mortgage-resources" }, { name: "Cash-out refinance", path: "/cash-out-refinance" }])]} />
    <GuidePage eyebrow="Home equity guide" title={title} summary="A cash-out refinance replaces your mortgage with a larger new mortgage and provides part of the difference in cash at closing. It can simplify borrowing into one payment, but it also changes the loan secured by your home." takeaways={["The new mortgage pays off the old loan and includes the cash borrowed.", "Closing costs, rate, term, and total secured debt all matter.", "Compare against a home equity loan or HELOC before replacing your first mortgage."]}>
      <section><h2>How does a cash-out refinance work?</h2><p>The new loan first pays off the current mortgage. After eligible costs and required reserves are accounted for, the approved cash-out amount is delivered at closing. Available proceeds depend on verified value, existing liens, program limits, credit, income, and other underwriting factors.</p><p><Link href="/tools/cash-out-calculator">Estimate a starting equity range</Link>; the calculator is informational and is not an appraisal or underwriting result.</p></section>
      <section><h2>What should you compare?</h2><ul className="list-disc space-y-2 pl-5"><li>The rate and payment on the entire new mortgage—not only the cash received.</li><li>Closing costs and how they are paid.</li><li>Whether the payoff date becomes later.</li><li>The cost and risk of turning unsecured debt into debt secured by your home.</li><li>Alternatives that preserve the existing first-mortgage terms.</li></ul></section>
      <section><h2>Cash-out refinance versus other equity products</h2><p>A home equity loan or HELOC usually sits alongside the first mortgage instead of replacing it. That can preserve an existing first-mortgage rate, but creates a separate payment and its own terms. See the full <Link href="/home-equity-options">home equity product comparison</Link>.</p></section>
      <section><h2>Independent consumer guidance</h2><p>The CFPB explains that using home equity can shift debt onto the home and increase foreclosure risk if payments become unsustainable. Review its <a href="https://www.consumerfinance.gov/consumer-tools/mortgages/" rel="noopener noreferrer">mortgage resources</a> and compare formal Loan Estimates before deciding.</p></section>
    </GuidePage>
  </>;
}
