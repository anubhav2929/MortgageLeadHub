import Link from "next/link";
import { Percent, Wallet, Clock, Scale, ArrowRight } from "lucide-react";
import { MktNav } from "@/components/marketing/mkt-nav";
import { MktFooter } from "@/components/marketing/mkt-footer";
import { seoMetadata } from "@/lib/seo";

export const metadata = seoMetadata({
  title: "Free Mortgage Calculators | Equity Flow Group",
  description: "Free calculators for refinancing, cash-out equity, mortgage payoff, and debt-to-income — no signup required.",
  path: "/tools",
  keywords: ["mortgage calculators", "refinance calculator", "cash-out calculator", "DTI calculator", "mortgage payoff calculator"],
});

const TOOLS = [
  {
    href: "/tools/refinance-calculator",
    icon: Percent,
    title: "Refinance calculator",
    description: "Estimate your new monthly payment at today's example rate.",
  },
  {
    href: "/tools/cash-out-calculator",
    icon: Wallet,
    title: "Cash-out refinance calculator",
    description: "See how much of your home equity you could turn into cash.",
  },
  {
    href: "/tools/mortgage-payoff-calculator",
    icon: Clock,
    title: "Mortgage payoff calculator",
    description: "Find out how much time and interest an extra payment could save.",
  },
  {
    href: "/tools/dti-calculator",
    icon: Scale,
    title: "Debt-to-income calculator",
    description: "Check your front-end and back-end DTI against typical loan limits.",
  },
];

export default function ToolsIndexPage() {
  return (
    <div className="mkt flex-1 overflow-y-auto">
      <MktNav />
      <main>
        <section className="bg-[var(--mkt-bg)] py-14 sm:py-20">
          <div className="mx-auto max-w-3xl px-6 text-center">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-[var(--mkt-primary)]">Free tools</p>
            <h1 className="mkt-balance mt-1.5 text-[34px] font-semibold tracking-tight text-[var(--mkt-ink)] sm:text-[42px]">
              Mortgage calculators
            </h1>
            <p className="mx-auto mt-3 max-w-xl text-[15px] leading-relaxed text-[var(--mkt-body)]">
              Quick, anonymous estimates — no name, phone, or email required to use any of these.
            </p>
          </div>
        </section>

        <div className="mx-auto max-w-4xl px-6 pb-16">
          <div className="grid gap-4 sm:grid-cols-2">
            {TOOLS.map((tool) => (
              <Link
                key={tool.href}
                href={tool.href}
                className="group flex flex-col rounded-2xl border border-[var(--mkt-border)] bg-white p-6 transition-shadow hover:shadow-[0_2px_8px_rgba(22,33,27,0.04),0_20px_48px_-24px_rgba(22,33,27,0.18)]"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--mkt-primary-tint)] text-[var(--mkt-primary)]">
                  <tool.icon className="h-5 w-5" />
                </span>
                <h2 className="mt-4 text-[16px] font-semibold text-[var(--mkt-ink)]">{tool.title}</h2>
                <p className="mt-1.5 flex-1 text-[13.5px] leading-relaxed text-[var(--mkt-body)]">{tool.description}</p>
                <span className="mt-4 flex items-center gap-1.5 text-[13px] font-medium text-[var(--mkt-primary)]">
                  Try it <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </main>

      <MktFooter />
    </div>
  );
}
