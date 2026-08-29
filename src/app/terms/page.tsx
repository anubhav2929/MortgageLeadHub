import { MktNav } from "@/components/marketing/mkt-nav";
import { MktFooter } from "@/components/marketing/mkt-footer";
import { LegalBody } from "@/components/marketing/legal-body";
import { getLegalPage } from "@/domain/queries";
import { seoMetadata } from "@/lib/seo";

export async function generateMetadata() {
  return seoMetadata({ title: "Terms of Service | Equity Flow Group", description: "Terms governing use of the Equity Flow Group mortgage education, inquiry, status, and communications services.", path: "/terms" });
}

export default async function TermsPage() {
  // Admin override wins; absent means serve the built-in copy below, so a
  // deployment that never edits this still has a complete page.
  const override = await getLegalPage("terms");

  return (
    <div className="mkt flex-1 overflow-y-auto">
      <MktNav />
      <main className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-2xl font-semibold text-[var(--mkt-ink)]">Terms of Service</h1>
        <p className="mt-2 text-xs text-[var(--mkt-muted)]">Last updated: August 29, 2026</p>

        {override ? (
          <LegalBody body={override.body} />
        ) : (
        <div className="mt-8 space-y-6 text-[13.5px] leading-relaxed text-[var(--mkt-body)]">
          <section>
            <h2 className="text-[15px] font-semibold text-[var(--mkt-ink)]">Using this service</h2>
            <p className="mt-2">
              You may use this site to review educational information, submit a mortgage inquiry, communicate about
              that inquiry, and use preliminary calculators. Provide accurate information, use the service only for
              lawful purposes, and do not attempt to interfere with its security or operation.
            </p>
          </section>
          <section>
            <h2 className="text-[15px] font-semibold text-[var(--mkt-ink)]">Not a loan application</h2>
            <p className="mt-2">
              Submitting the intake form on this site is an inquiry, not a loan application. It does not affect your
              credit score and is not an approval or offer of credit. A licensed loan officer will follow up to
              discuss your options and any actual loan application is a separate step handled directly with them.
            </p>
          </section>
          <section>
            <h2 className="text-[15px] font-semibold text-[var(--mkt-ink)]">Communications consent</h2>
            <p className="mt-2">
              By checking the consent boxes on the intake form, you agree to be contacted by the selected channels
              (phone, text, and/or email), including by automatic dialing systems, prerecorded messages, or an AI
              assistant where applicable. Consent to be contacted is not a condition of receiving loan services.
              Message and data rates may apply to text messages.
            </p>
            {/* Carriers read this page during 10DLC review and look for the
                CTIA-standard disclosures spelled out, not implied. */}
            <p className="mt-2">
              Message frequency varies with your inquiry. Reply{" "}
              <strong className="text-[var(--mkt-ink)]">STOP</strong> at any time to opt out of all messages, or{" "}
              <strong className="text-[var(--mkt-ink)]">HELP</strong> for assistance. Carriers are not liable for
              delayed or undelivered messages. We do not sell or share mobile opt-in information with third parties
              for their own marketing.
            </p>
            <p className="mt-2">
              Text-message consent is optional, unchecked by default, and separate from submitting an inquiry. You
              may also use our <a href="/unsubscribe" className="font-medium text-[var(--mkt-primary)] hover:underline">online opt-out page</a>.
            </p>
          </section>
          <section>
            <h2 className="text-[15px] font-semibold text-[var(--mkt-ink)]">Educational estimates</h2>
            <p className="mt-2">
              Calculators, property-value ranges, and other automated results are informational estimates, not
              appraisals, underwriting decisions, rate locks, or offers. Actual eligibility, value, rates, fees, and
              terms require verification by the applicable licensed professionals and providers.
            </p>
          </section>
          <section>
            <h2 className="text-[15px] font-semibold text-[var(--mkt-ink)]">No warranty</h2>
            <p className="mt-2">
              This site and the information it provides are offered &quot;as is&quot; without warranties of any kind.
              Loan terms, rates, and eligibility are determined by the licensed lender and officer you work with, not
              by this website.
            </p>
          </section>
        </div>
        )}
      </main>
      <MktFooter />
    </div>
  );
}
