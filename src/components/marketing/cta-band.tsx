import Link from "next/link";
import { ArrowRight } from "lucide-react";

export function CtaBand() {
  return (
    <section className="bg-[var(--mkt-ink)] py-16 sm:py-20">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-6 text-center">
        <h2 className="mkt-balance max-w-xl text-[28px] font-semibold leading-tight text-white sm:text-[34px]">
          See what you could save — it only takes a couple of minutes.
        </h2>
        <Link
          href="/apply"
          className="group flex items-center gap-2 rounded-lg bg-white px-6 py-3.5 text-[15px] font-semibold text-[var(--mkt-ink)] transition-transform hover:-translate-y-0.5"
        >
          Check my options
          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        </Link>
        <p className="text-[12.5px] text-white/50">No impact to your credit score · No obligation to proceed</p>
      </div>
    </section>
  );
}
