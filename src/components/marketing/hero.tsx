import { CheckCircle2 } from "lucide-react";
import { QuickStartForm } from "@/components/marketing/quick-start-form";
import { ABTest } from "@/components/marketing/ab-test";

const TRUST_POINTS = ["No impact to your credit score", "Licensed loan officers, real people", "Free, no obligation to proceed"];

function HeroCopyA() {
  return (
    <>
      <h1 className="mkt-balance text-[42px] font-semibold leading-[1.1] tracking-tight text-[var(--mkt-ink)] sm:text-[54px]">
        Refinance your rate, or turn your equity into cash.
      </h1>
      <p className="mt-5 max-w-lg text-[17px] leading-relaxed text-[var(--mkt-body)]">
        Tell us about your home, and a licensed loan officer will walk you through real options for lowering
        your payment or accessing the equity you&apos;ve built — no pressure, no spam, no surprise calls at
        9pm.
      </p>
    </>
  );
}

function HeroCopyB() {
  return (
    <>
      <h1 className="mkt-balance text-[42px] font-semibold leading-[1.1] tracking-tight text-[var(--mkt-ink)] sm:text-[54px]">
        See what your home&apos;s equity could do for you.
      </h1>
      <p className="mt-5 max-w-lg text-[17px] leading-relaxed text-[var(--mkt-body)]">
        A two-minute form connects you with a licensed loan officer who&apos;ll lay out your real options — lower
        payments, cash out, or both — with no obligation and no pressure to move forward.
      </p>
    </>
  );
}

export function Hero() {
  return (
    <section className="relative overflow-hidden bg-[var(--mkt-bg)]">
      <div
        className="pointer-events-none absolute -right-40 -top-40 h-[560px] w-[560px] rounded-full opacity-60 blur-3xl"
        style={{ background: "radial-gradient(circle, var(--mkt-primary-tint), transparent 70%)" }}
      />
      <div className="relative mx-auto grid max-w-6xl gap-14 px-6 pb-20 pt-14 sm:pb-24 sm:pt-20 md:grid-cols-[1.05fr_0.95fr] md:items-center">
        <div>
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-[var(--mkt-border)] bg-white px-3 py-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--mkt-primary)]" />
            <span className="text-[12px] font-medium text-[var(--mkt-body)]">A licensed officer follows up within minutes</span>
          </div>

          <ABTest testKey="homepage_hero_copy" variants={{ A: <HeroCopyA />, B: <HeroCopyB /> }} />

          <ul className="mt-7 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:gap-x-6 sm:gap-y-2">
            {TRUST_POINTS.map((point) => (
              <li key={point} className="flex items-center gap-2 text-[13.5px] text-[var(--mkt-body)]">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-[var(--mkt-primary)]" />
                {point}
              </li>
            ))}
          </ul>
        </div>

        <div className="flex justify-center md:justify-end">
          <QuickStartForm />
        </div>
      </div>
    </section>
  );
}
