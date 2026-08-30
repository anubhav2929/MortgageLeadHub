import { BrandIconBadge, FlowIcon, GrowthIcon, HomeEquityIcon, TrustIcon } from "@/components/brand/brand-icons";

const PROPS = [
  {
    icon: FlowIcon,
    title: "Lower your payment",
    body: "If rates have dropped since you bought, refinancing could mean real monthly savings.",
  },
  {
    icon: GrowthIcon,
    title: "Access your equity",
    body: "Turn the value you've built into cash for renovations, tuition, or anything else.",
  },
  {
    icon: HomeEquityIcon,
    title: "Shorten your term",
    body: "Move from a 30-year to a 15-year loan and own your home outright, sooner.",
  },
  {
    icon: TrustIcon,
    title: "Simplify monthly payments",
    body: "Use available equity to address higher-interest credit-card or personal balances through one planned payment.",
  },
];

export function ValueProps() {
  return (
    <section className="bg-[var(--mkt-bg)] py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mb-12 max-w-xl">
          <p className="text-[13px] font-semibold uppercase tracking-wide text-[var(--mkt-primary)]">Why people refinance</p>
          <h2 className="mkt-balance mt-2 text-[30px] font-semibold leading-tight text-[var(--mkt-ink)] sm:text-[34px]">
            Whatever the reason, we&apos;ll help you find the right option.
          </h2>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PROPS.map((p) => (
            <div
              key={p.title}
              className="rounded-2xl border border-[var(--mkt-border)] bg-white p-6 transition-shadow hover:shadow-[0_12px_32px_-16px_rgba(22,33,27,0.15)]"
            >
              <BrandIconBadge><p.icon className="h-5 w-5" /></BrandIconBadge>
              <h3 className="mt-4 text-[16px] font-semibold text-[var(--mkt-ink)]">{p.title}</h3>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-[var(--mkt-body)]">{p.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
