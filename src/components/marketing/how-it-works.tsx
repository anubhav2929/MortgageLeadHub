const STEPS = [
  {
    n: "1",
    title: "Tell us about your home",
    body: "A short form — your goal, your property, and how we can reach you. Takes about two minutes.",
  },
  {
    n: "2",
    title: "We check your options",
    body: "We match your details against current programs and confirm you're eligible before anyone calls.",
  },
  {
    n: "3",
    title: "Talk to a licensed officer",
    body: "A real, licensed loan officer reaches out at the time you asked for — never before 8am or after 9pm.",
  },
  {
    n: "4",
    title: "Review your offer",
    body: "See your rate and terms in plain language, with nothing to sign until you're ready.",
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="border-y border-[var(--mkt-border)] bg-[var(--mkt-bg-alt)] py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mb-12 max-w-xl">
          <p className="text-[13px] font-semibold uppercase tracking-wide text-[var(--mkt-primary)]">How it works</p>
          <h2 className="mkt-balance mt-2 text-[30px] font-semibold leading-tight text-[var(--mkt-ink)] sm:text-[34px]">
            From form to offer in four steps.
          </h2>
        </div>

        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step) => (
            <div key={step.n}>
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--mkt-ink)] text-[14px] font-semibold text-white">
                {step.n}
              </span>
              <h3 className="mt-4 text-[16px] font-semibold text-[var(--mkt-ink)]">{step.title}</h3>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-[var(--mkt-body)]">{step.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
