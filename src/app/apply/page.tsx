import { CheckCircle2, ShieldCheck } from "lucide-react";
import { IntakeWizard } from "@/components/intake/intake-wizard";
import { MktFooter } from "@/components/marketing/mkt-footer";
import { MktNav } from "@/components/marketing/mkt-nav";
import type { LoanIntent } from "@/domain/types";
import { seoMetadata } from "@/lib/seo";
import { getActiveIntakeDisclosures } from "@/domain/queries";

export const metadata = seoMetadata({ title: "Mortgage Refinance & Home Equity Inquiry", description: "Tell Equity Flow Group what you want to accomplish and choose how a licensed loan officer may contact you. This is an inquiry, not a loan application.", path: "/apply" });

interface PageProps {
  searchParams: Promise<{ intent?: string; stateCode?: string; estimatedValue?: string }>;
}

const VALID_INTENTS: LoanIntent[] = ["REFINANCE", "HOME_EQUITY", "CASH_OUT"];

export default async function ApplyPage({ searchParams }: PageProps) {
  const [params, disclosures] = await Promise.all([searchParams, getActiveIntakeDisclosures()]);
  const intent = VALID_INTENTS.includes(params.intent as LoanIntent) ? (params.intent as LoanIntent) : undefined;

  return (
    <div className="mkt flex-1 overflow-y-auto">
      <MktNav />
      <main className="relative overflow-hidden bg-[var(--mkt-bg)]">
        <div
          className="pointer-events-none absolute -right-32 -top-48 h-[620px] w-[620px] rounded-full opacity-70 blur-3xl"
          style={{ background: "radial-gradient(circle, var(--mkt-primary-tint), transparent 70%)" }}
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -left-40 top-32 h-[420px] w-[420px] rounded-full opacity-50 blur-3xl"
          style={{ background: "radial-gradient(circle, var(--mkt-primary-tint), transparent 72%)" }}
          aria-hidden
        />
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.35]"
          style={{
            backgroundImage:
              "linear-gradient(to right, var(--mkt-border) 1px, transparent 1px), linear-gradient(to bottom, var(--mkt-border) 1px, transparent 1px)",
            backgroundSize: "56px 56px",
            maskImage: "radial-gradient(ellipse 80% 55% at 50% 0%, #000 40%, transparent 100%)",
            WebkitMaskImage: "radial-gradient(ellipse 80% 55% at 50% 0%, #000 40%, transparent 100%)",
          }}
          aria-hidden
        />

        <div className="relative mx-auto max-w-6xl px-6 pb-16 pt-12 sm:pb-20 sm:pt-16">
          <div className="mx-auto max-w-3xl text-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--mkt-border)] bg-white/90 px-3 py-1.5 shadow-sm backdrop-blur-sm">
              <ShieldCheck className="h-3.5 w-3.5 text-[var(--mkt-primary)]" />
              <span className="text-[12px] font-medium text-[var(--mkt-body)]">Secure mortgage inquiry · about two minutes</span>
            </div>
            <h1 className="mkt-balance mt-5 text-[36px] font-semibold leading-[1.12] tracking-tight text-[var(--mkt-ink)] sm:text-[48px]">
              Tell us what you want to change about your mortgage.
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-[16px] leading-7 text-[var(--mkt-body)]">
              Share a few property and contact details so a licensed loan officer can discuss relevant refinance or home-equity options with you.
            </p>
            <ul className="mt-5 flex flex-col items-center justify-center gap-2 sm:flex-row sm:flex-wrap sm:gap-x-6">
              {["No hard credit inquiry", "No obligation to proceed", "Your answers are saved as reported"].map((point) => (
                <li key={point} className="flex items-center gap-2 text-[13px] text-[var(--mkt-body)]">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-[var(--mkt-primary)]" />
                  {point}
                </li>
              ))}
            </ul>
          </div>
          <div className="mx-auto mt-8 max-w-2xl">
            <IntakeWizard
              disclosures={disclosures}
              initialIntent={intent}
              initialStateCode={params.stateCode}
              initialEstimatedValue={params.estimatedValue}
            />
          </div>
        </div>
      </main>
      <MktFooter />
    </div>
  );
}
