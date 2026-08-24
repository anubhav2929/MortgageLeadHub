import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { MktNav } from "@/components/marketing/mkt-nav";
import { MktFooter } from "@/components/marketing/mkt-footer";
import { Breadcrumbs } from "@/components/marketing/breadcrumbs";
import { CtaBand } from "@/components/marketing/cta-band";

export function GuidePage({ eyebrow, title, summary, takeaways, children }: {
  eyebrow: string;
  title: string;
  summary: string;
  takeaways: string[];
  children: ReactNode;
}) {
  return (
    <div className="mkt flex-1 overflow-y-auto">
      <MktNav />
      <main>
        <article>
          <header className="border-b border-[var(--mkt-border)] bg-[var(--mkt-bg)] py-12 sm:py-16">
            <div className="mx-auto max-w-4xl px-6">
              <Breadcrumbs items={[{ name: "Home", href: "/" }, { name: "Mortgage resources", href: "/mortgage-resources" }, { name: title, href: "#" }]} />
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--mkt-primary)]">{eyebrow}</p>
              <h1 className="mkt-balance mt-2 max-w-3xl text-[36px] font-semibold leading-tight tracking-tight text-[var(--mkt-ink)] sm:text-[48px]">{title}</h1>
              <p className="mt-5 max-w-3xl text-[17px] leading-8 text-[var(--mkt-body)]">{summary}</p>
              <p className="mt-4 text-xs text-[var(--mkt-muted)]">Reviewed by Equity Flow Group lending operations · Updated August 24, 2026</p>
            </div>
          </header>
          <div className="mx-auto grid max-w-5xl gap-10 px-6 py-12 lg:grid-cols-[minmax(0,1fr)_17rem]">
            <div className="space-y-9 text-[15px] leading-7 text-[var(--mkt-body)] [&_h2]:text-[24px] [&_h2]:font-semibold [&_h2]:leading-tight [&_h2]:text-[var(--mkt-ink)] [&_h3]:text-[17px] [&_h3]:font-semibold [&_h3]:text-[var(--mkt-ink)] [&_a]:font-medium [&_a]:text-[var(--mkt-primary)] [&_a]:underline-offset-4 hover:[&_a]:underline">
              {children}
            </div>
            <aside className="h-fit rounded-2xl border border-[var(--mkt-border)] bg-[var(--mkt-bg-alt)] p-5 lg:sticky lg:top-24">
              <h2 className="text-[15px] font-semibold text-[var(--mkt-ink)]">Key takeaways</h2>
              <ul className="mt-3 space-y-3">
                {takeaways.map((item) => <li key={item} className="flex gap-2 text-[13px] leading-5 text-[var(--mkt-body)]"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--mkt-primary)]" />{item}</li>)}
              </ul>
              <Link href="/tools" className="mt-5 flex items-center gap-1.5 text-[13px] font-medium text-[var(--mkt-primary)]">Explore mortgage calculators <ArrowRight className="h-3.5 w-3.5" /></Link>
            </aside>
          </div>
        </article>
        <CtaBand />
      </main>
      <MktFooter />
    </div>
  );
}
