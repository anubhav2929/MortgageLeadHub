import type { ReactNode } from "react";
import { MktNav } from "@/components/marketing/mkt-nav";
import { MktFooter } from "@/components/marketing/mkt-footer";
import { CtaBand } from "@/components/marketing/cta-band";
import Link from "next/link";

/** Shared chrome for standalone /tools/* SEO calculator pages — same nav,
 *  footer, and CTA band as the homepage, so each tool is a real indexable
 *  page (own URL + <title>/description) rather than a homepage section. */
export function ToolPageShell({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="mkt flex-1 overflow-y-auto">
      <MktNav />
      <main>
        <section className="border-b border-[var(--mkt-border)] bg-[var(--mkt-bg)] py-14 sm:py-20">
          <div className="mx-auto max-w-3xl px-6 text-center">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-[var(--mkt-primary)]">{eyebrow}</p>
            <h1 className="mkt-balance mt-1.5 text-[34px] font-semibold tracking-tight text-[var(--mkt-ink)] sm:text-[42px]">{title}</h1>
            <p className="mx-auto mt-3 max-w-xl text-[15px] leading-relaxed text-[var(--mkt-body)]">{description}</p>
          </div>
        </section>
        <div className="mx-auto max-w-3xl px-6 py-12">{children}</div>
        <section className="border-y border-[var(--mkt-border)] bg-[var(--mkt-bg-alt)] py-10">
          <div className="mx-auto max-w-3xl px-6">
            <h2 className="text-[18px] font-semibold text-[var(--mkt-ink)]">Continue researching</h2>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm font-medium text-[var(--mkt-primary)]">
              <Link href="/mortgage-refinance">Mortgage refinance guide</Link>
              <Link href="/cash-out-refinance">Cash-out refinance guide</Link>
              <Link href="/home-equity-options">Home equity options</Link>
              <Link href="/tools">All calculators</Link>
            </div>
          </div>
        </section>
        <CtaBand />
      </main>
      <MktFooter />
    </div>
  );
}
