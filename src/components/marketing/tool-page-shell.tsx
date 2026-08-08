import type { ReactNode } from "react";
import { MktNav } from "@/components/marketing/mkt-nav";
import { MktFooter } from "@/components/marketing/mkt-footer";
import { CtaBand } from "@/components/marketing/cta-band";

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
        <CtaBand />
      </main>
      <MktFooter />
    </div>
  );
}
