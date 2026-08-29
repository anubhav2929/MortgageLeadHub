import Link from "next/link";
import { MktNav } from "@/components/marketing/mkt-nav";
import { MktFooter } from "@/components/marketing/mkt-footer";
import { LegalBody } from "@/components/marketing/legal-body";
import { getLegalPage } from "@/domain/queries";
import { seoMetadata } from "@/lib/seo";
import { getConfigValues } from "@/lib/runtimeConfig";

export async function generateMetadata() {
  return seoMetadata({ title: "Privacy Policy | Equity Flow Group", description: "How Equity Flow Group collects, uses, protects, and retains information provided through mortgage inquiries and communications.", path: "/privacy" });
}

export default async function PrivacyPage() {
  // Admin override wins; absent means serve the built-in copy below, so a
  // deployment that never edits this still has a complete page.
  const override = await getLegalPage("privacy");
  const company = await getConfigValues(["COMPANY_LEGAL_NAME", "COMPANY_SUPPORT_EMAIL", "COMPANY_SUPPORT_PHONE", "COMPANY_BUSINESS_ADDRESS"]);
  const legalName = company.COMPANY_LEGAL_NAME || "Equity Flow Group";
  const supportEmail = company.COMPANY_SUPPORT_EMAIL || "inquiry@equityflowgroup.com";

  return (
    <div className="mkt flex-1 overflow-y-auto">
      <MktNav />
      <main className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-2xl font-semibold text-[var(--mkt-ink)]">Privacy Policy</h1>
        <p className="mt-2 text-xs text-[var(--mkt-muted)]">Last updated: August 29, 2026</p>

        {override ? (
          <LegalBody body={override.body} />
        ) : (
        <div className="mt-8 space-y-6 text-[13.5px] leading-relaxed text-[var(--mkt-body)]">
          <section>
            <h2 className="text-[15px] font-semibold text-[var(--mkt-ink)]">What we collect</h2>
            <p className="mt-2">
              When you submit an inquiry, {legalName} collects information you provide, including your name, contact
              details, property information, mortgage goals, preferred contact time, consent selections, and other
              details you choose to share. We also record the source page, disclosure version, timestamp, IP address,
              browser information, and communication history needed to document and service your request.
            </p>
          </section>
          <section>
            <h2 className="text-[15px] font-semibold text-[var(--mkt-ink)]">Where information comes from</h2>
            <p className="mt-2">
              Information comes from you when you use the site or communicate with us, from service providers that
              deliver calls, texts, emails, property information, or security services on our behalf, and from
              permitted public records when needed to respond to your inquiry. We do not buy contact lists for this
              text messaging program and do not use scraped contact details for automated outreach.
            </p>
          </section>
          <section>
            <h2 className="text-[15px] font-semibold text-[var(--mkt-ink)]">How we use it</h2>
            <p className="mt-2">
              We use information to respond to your inquiry, preserve context across phone, text, and email, route
              the inquiry to an appropriately licensed loan officer, schedule requested callbacks, prevent duplicate
              or unwanted contact, maintain security and audit records, and comply with applicable obligations. We
              do not sell personal information.
            </p>
          </section>
          {/* Required for 10DLC campaign approval. Carriers review this page
              directly, and the single most common rejection reason is the
              absence of an explicit statement that mobile opt-in data is not
              shared or sold — a general "we do not sell your information"
              elsewhere on the page is not accepted as covering it. */}
          <section>
            <h2 className="text-[15px] font-semibold text-[var(--mkt-ink)]">Text messaging (SMS)</h2>
            <p className="mt-2">
              If you separately check the optional text-message consent box, {legalName} may send recurring
              informational and marketing messages about the mortgage refinance or home-equity inquiry you submitted,
              including requested follow-ups, answers, and callback confirmations or reminders. Message frequency
              varies. Message and data rates may apply. Consent is not a condition of obtaining goods or services.
            </p>
            <p className="mt-2">
              <strong className="text-[var(--mkt-ink)]">
                We do not sell, rent, or share mobile opt-in information or phone numbers with third parties or
                affiliates for their own marketing purposes.
              </strong>{" "}
              Your number is used only to contact you about your own inquiry and is shared with service providers
              (such as our telephony carrier) solely to deliver those messages on our behalf.
            </p>
            <p className="mt-2">
              Reply <strong className="text-[var(--mkt-ink)]">STOP</strong> to any message to opt out; we will send
              one confirmation and then stop text messaging you. Reply{" "}
              <strong className="text-[var(--mkt-ink)]">HELP</strong> for assistance, or email{" "}
              <a href={`mailto:${supportEmail}`} className="font-medium text-[var(--mkt-primary)] hover:underline">
                {supportEmail}
              </a>
              . Message and data rates may apply. Carriers are not liable for delayed or undelivered messages.
            </p>
          </section>
          <section>
            <h2 className="text-[15px] font-semibold text-[var(--mkt-ink)]">Service providers and disclosure</h2>
            <p className="mt-2">
              We disclose information to vendors that host the service, deliver communications, provide security or
              analytics with consent, and support requested mortgage-inquiry functions. They may use the information
              only to perform services for us. We may also disclose information when required by law, to protect the
              service and its users, or as part of a business transaction subject to appropriate safeguards.
            </p>
          </section>
          <section>
            <h2 className="text-[15px] font-semibold text-[var(--mkt-ink)]">Retention and security</h2>
            <p className="mt-2">
              We retain inquiry, consent, communication, suppression, and audit records for as long as reasonably
              necessary for the purposes described here and applicable recordkeeping requirements. We use access
              controls, encryption, provider signature checks, and activity logging designed to protect information.
              No security measure can guarantee absolute protection.
            </p>
          </section>
          <section>
            <h2 className="text-[15px] font-semibold text-[var(--mkt-ink)]">Your choices</h2>
            <p className="mt-2">
              You can opt out of all future calls, texts, and emails at any time at{" "}
              <Link href="/unsubscribe" className="font-medium text-[var(--mkt-primary)] hover:underline">
                /unsubscribe
              </Link>
              , or by replying STOP to any text message. You can check the status of your inquiry at{" "}
              <Link href="/status" className="font-medium text-[var(--mkt-primary)] hover:underline">
                /status
              </Link>
              .
            </p>
          </section>
          <section>
            <h2 className="text-[15px] font-semibold text-[var(--mkt-ink)]">Fair Credit Reporting Act (FCRA)</h2>
            <p className="mt-2">
              Submitting the intake form does not authorize a credit report or credit score pull and does not affect
              your credit score. If you move forward and formally apply with a licensed loan officer, they may obtain
              your credit report or score in connection with that application. Under the FCRA, you have the right to
              know what is in your credit file, to dispute incomplete or inaccurate information with the consumer
              reporting agency, and to obtain a copy of your credit report. Learn more at{" "}
              <a href="https://consumerfinance.gov/learnmore" target="_blank" rel="noreferrer" className="font-medium text-[var(--mkt-primary)] hover:underline">
                consumerfinance.gov/learnmore
              </a>
              .
            </p>
          </section>
          <section>
            <h2 className="text-[15px] font-semibold text-[var(--mkt-ink)]">Contact</h2>
            <p className="mt-2">
              Questions or privacy requests can be sent to <a href={`mailto:${supportEmail}`} className="font-medium text-[var(--mkt-primary)] hover:underline">{supportEmail}</a>
              {company.COMPANY_SUPPORT_PHONE ? ` or ${company.COMPANY_SUPPORT_PHONE}` : ""}. {company.COMPANY_BUSINESS_ADDRESS ? `Mail may be sent to ${company.COMPANY_BUSINESS_ADDRESS}.` : ""}
            </p>
          </section>
        </div>
        )}
      </main>
      <MktFooter />
    </div>
  );
}
