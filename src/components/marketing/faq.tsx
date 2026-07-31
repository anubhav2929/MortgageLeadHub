import { ChevronDown } from "lucide-react";

const FAQS = [
  {
    q: "Will this affect my credit score?",
    a: "No. Submitting the form is a soft inquiry only and does not affect your credit score. It is not a loan application and not an approval or offer of credit.",
  },
  {
    q: "How fast will someone contact me?",
    a: "A licensed officer typically reaches out within a few minutes during the day, and always within your requested contact window — never before 8am or after 9pm your local time.",
  },
  {
    q: "Is my information kept private?",
    a: "Yes. Your details are used only to evaluate your options and are never sold. You control how we reach you, and you can withdraw consent at any time.",
  },
  {
    q: "What if I want to stop being contacted?",
    a: "Reply STOP to any text or tell your officer directly — it takes effect immediately and permanently, across every channel.",
  },
  {
    q: "Do I have to move forward after I apply?",
    a: "No. There's no obligation at any point. You can review your options and decide not to continue, with no cost and no pressure.",
  },
];

export function Faq() {
  return (
    <section id="faq" className="bg-[var(--mkt-bg)] py-20 sm:py-24">
      <div className="mx-auto max-w-3xl px-6">
        <div className="mb-10 text-center">
          <p className="text-[13px] font-semibold uppercase tracking-wide text-[var(--mkt-primary)]">Questions</p>
          <h2 className="mkt-balance mt-2 text-[30px] font-semibold leading-tight text-[var(--mkt-ink)] sm:text-[34px]">
            Good to know before you start.
          </h2>
        </div>

        <div className="divide-y divide-[var(--mkt-border)] rounded-2xl border border-[var(--mkt-border)] bg-white">
          {FAQS.map((item) => (
            <details key={item.q} className="group px-6 py-1 open:pb-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-[15px] font-medium text-[var(--mkt-ink)]">
                {item.q}
                <ChevronDown className="h-4 w-4 shrink-0 text-[var(--mkt-muted)] transition-transform group-open:rotate-180" />
              </summary>
              <p className="text-[13.5px] leading-relaxed text-[var(--mkt-body)]">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
