import Link from "next/link";
import { capabilities, env } from "@/lib/env";
import { STATE_NAMES } from "@/domain/stateTimezone";

// Set your real NMLS ID before a real launch — this reads from an env var
// specifically so it can't be silently forgotten inside a component nobody
// re-opens after launch; the fallback is intentionally an obvious
// placeholder rather than a real-looking fake number.
const NMLS_ID = env.COMPANY_NMLS_ID || "SET_COMPANY_NMLS_ID";

// Derived from the same STATE_NAMES the intake form uses, instead of a
// hand-maintained list — the two had already drifted apart once (NV and SC
// were accepted on the form but silently missing from this legal disclosure).
const LICENSED_STATES_LABEL = (() => {
  const codes = Object.keys(STATE_NAMES).sort();
  return codes.length > 1 ? `${codes.slice(0, -1).join(", ")}, and ${codes[codes.length - 1]}` : codes.join("");
})();

export function MktFooter() {
  const anyChannelLive = capabilities.hasTwilio || capabilities.hasResend || capabilities.hasLiveVoiceAgent;

  return (
    <footer className="bg-[var(--mkt-bg-alt)]">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <div className="flex flex-col gap-8 sm:flex-row sm:justify-between">
          <div className="max-w-sm">
            <p className="text-[14px] font-semibold text-[var(--mkt-ink)]">Equity Flow Group</p>
            <p className="mt-2 text-[12.5px] leading-relaxed text-[var(--mkt-muted)]">
              Equity Flow Group Lending, NMLS #{NMLS_ID}. Equal Housing Lender. Licensed in {LICENSED_STATES_LABEL}.
            </p>
          </div>
          <div className="flex gap-10">
            <div>
              <p className="text-[12px] font-semibold uppercase tracking-wide text-[var(--mkt-muted)]">Get started</p>
              <div className="mt-2.5 flex flex-col gap-2">
                <Link href="/apply" className="text-[13px] text-[var(--mkt-body)] hover:text-[var(--mkt-ink)]">
                  Check my options
                </Link>
                <Link href="/tools" className="text-[13px] text-[var(--mkt-body)] hover:text-[var(--mkt-ink)]">
                  Free calculators
                </Link>
                <Link href="/#faq" className="text-[13px] text-[var(--mkt-body)] hover:text-[var(--mkt-ink)]">
                  FAQ
                </Link>
                <Link href="/status" className="text-[13px] text-[var(--mkt-body)] hover:text-[var(--mkt-ink)]">
                  Check my inquiry status
                </Link>
                <Link href="/unsubscribe" className="text-[13px] text-[var(--mkt-body)] hover:text-[var(--mkt-ink)]">
                  Opt out of communications
                </Link>
              </div>
            </div>
            <div>
              <p className="text-[12px] font-semibold uppercase tracking-wide text-[var(--mkt-muted)]">Company</p>
              <div className="mt-2.5 flex flex-col gap-2">
                <Link href="/workspace" className="text-[13px] text-[var(--mkt-body)] hover:text-[var(--mkt-ink)]">
                  Officer login
                </Link>
                <Link href="/privacy" className="text-[13px] text-[var(--mkt-body)] hover:text-[var(--mkt-ink)]">
                  Privacy Policy
                </Link>
                <Link href="/terms" className="text-[13px] text-[var(--mkt-body)] hover:text-[var(--mkt-ink)]">
                  Terms of Service
                </Link>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-10 border-t border-[var(--mkt-border)] pt-6">
          <p className="text-[11.5px] leading-relaxed text-[var(--mkt-muted)]">
            {!anyChannelLive && "This is a demo environment with synthetic data only — not a live consumer-facing service. "}
            Submitting the form on this site is an inquiry, not a loan application, and does not affect your credit
            score or constitute an approval or offer of credit. A licensed loan officer will follow up to discuss
            your options.
          </p>
        </div>
      </div>
    </footer>
  );
}
