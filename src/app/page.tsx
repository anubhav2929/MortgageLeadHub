import { MktNav } from "@/components/marketing/mkt-nav";
import { Hero } from "@/components/marketing/hero";
import { TrustBar } from "@/components/marketing/trust-bar";
import { RateCalculator } from "@/components/marketing/rate-calculator";
import { ValueProps } from "@/components/marketing/value-props";
import { HowItWorks } from "@/components/marketing/how-it-works";
import { Faq } from "@/components/marketing/faq";
import { CtaBand } from "@/components/marketing/cta-band";
import { MktFooter } from "@/components/marketing/mkt-footer";
import { SeoJsonLd } from "@/components/marketing/seo-json-ld";
import { seoMetadata, absoluteUrl } from "@/lib/seo";
import Link from "next/link";

export const metadata = seoMetadata({
  title: "Mortgage Refinance & Home Equity Guidance | Equity Flow Group",
  description: "Explore mortgage refinance and home equity options, use free calculators, and request a conversation with a licensed loan officer.",
  path: "/",
  keywords: ["mortgage refinance", "home equity", "cash-out refinance", "mortgage calculators"],
});

export default function Home() {
  return (
    <div className="mkt flex-1 overflow-y-auto">
      <SeoJsonLd data={{ "@context": "https://schema.org", "@type": "WebSite", name: "Equity Flow Group", alternateName: "Equity Flow", url: absoluteUrl("/") }} />
      <MktNav />
      <main>
        <Hero />
        <TrustBar />
        <RateCalculator />
        <ValueProps />
        <HowItWorks />
        <Faq />
        <section className="bg-[var(--mkt-bg-alt)] py-16" aria-labelledby="mortgage-learning-title">
          <div className="mx-auto max-w-5xl px-6">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--mkt-primary)]">Mortgage learning center</p>
            <h2 id="mortgage-learning-title" className="mt-2 text-[28px] font-semibold text-[var(--mkt-ink)]">Understand your options before you inquire</h2>
            <p className="mt-3 max-w-3xl text-[15px] leading-7 text-[var(--mkt-body)]">Read plain-language, source-backed guides about replacing a mortgage, borrowing against equity, comparing products, and reviewing formal loan costs.</p>
            <div className="mt-6 flex flex-wrap gap-3 text-sm font-medium text-[var(--mkt-primary)]">
              <Link href="/mortgage-refinance" className="rounded-lg border border-[var(--mkt-border)] bg-white px-4 py-2.5">Mortgage refinancing guide</Link>
              <Link href="/cash-out-refinance" className="rounded-lg border border-[var(--mkt-border)] bg-white px-4 py-2.5">Cash-out refinance guide</Link>
              <Link href="/home-equity-options" className="rounded-lg border border-[var(--mkt-border)] bg-white px-4 py-2.5">Compare home equity options</Link>
              <Link href="/mortgage-resources" className="rounded-lg border border-[var(--mkt-border)] bg-white px-4 py-2.5">All resources</Link>
            </div>
          </div>
        </section>
        <CtaBand />
      </main>
      <MktFooter />
    </div>
  );
}
