import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { MktNav } from "@/components/marketing/mkt-nav";
import { MktFooter } from "@/components/marketing/mkt-footer";
import { Breadcrumbs } from "@/components/marketing/breadcrumbs";
import { SeoJsonLd } from "@/components/marketing/seo-json-ld";
import { breadcrumbJsonLd, seoMetadata } from "@/lib/seo";

export const metadata = seoMetadata({
  title: "Mortgage Refinance & Home Equity Resources | Equity Flow Group",
  description: "Clear guides and free calculators for mortgage refinancing, cash-out refinancing, home equity options, DTI, and payoff planning.",
  path: "/mortgage-resources",
  keywords: ["mortgage refinance guide", "home equity resources", "cash-out refinance", "mortgage calculators"],
});

const RESOURCES = [
  { href: "/mortgage-refinance", title: "Mortgage refinancing", description: "How replacing a mortgage works, what to compare, and how to estimate a break-even period." },
  { href: "/cash-out-refinance", title: "Cash-out refinancing", description: "How cash-out changes your mortgage balance and what to compare before using home equity." },
  { href: "/home-equity-options", title: "Home equity options", description: "A plain-language comparison of cash-out refinance, home equity loans, and HELOCs." },
  { href: "/tools", title: "Free mortgage calculators", description: "Estimate payments, cash-out availability, DTI, and the effect of extra principal payments." },
];

export default function MortgageResourcesPage() {
  return (
    <div className="mkt flex-1 overflow-y-auto">
      <SeoJsonLd data={breadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "Mortgage resources", path: "/mortgage-resources" }])} />
      <MktNav />
      <main className="bg-[var(--mkt-bg)]">
        <section className="mx-auto max-w-5xl px-6 py-14 sm:py-20">
          <Breadcrumbs items={[{ name: "Home", href: "/" }, { name: "Mortgage resources", href: "/mortgage-resources" }]} />
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--mkt-primary)]">Learning center</p>
          <h1 className="mkt-balance mt-2 max-w-3xl text-[38px] font-semibold tracking-tight text-[var(--mkt-ink)] sm:text-[48px]">Mortgage refinance and home equity resources</h1>
          <p className="mt-4 max-w-3xl text-[16px] leading-7 text-[var(--mkt-body)]">Understand the major choices before speaking with a licensed loan officer. These guides explain concepts and tradeoffs; they are not personalized financial advice or an offer of credit.</p>
          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            {RESOURCES.map((resource) => <Link key={resource.href} href={resource.href} className="group rounded-2xl border border-[var(--mkt-border)] bg-white p-6 hover:shadow-lg">
              <h2 className="text-[18px] font-semibold text-[var(--mkt-ink)]">{resource.title}</h2>
              <p className="mt-2 text-[14px] leading-6 text-[var(--mkt-body)]">{resource.description}</p>
              <span className="mt-4 flex items-center gap-1 text-[13px] font-medium text-[var(--mkt-primary)]">Read guide <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-0.5" /></span>
            </Link>)}
          </div>
        </section>
      </main>
      <MktFooter />
    </div>
  );
}
