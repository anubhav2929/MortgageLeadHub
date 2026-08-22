import type { Metadata } from "next";
import Link from "next/link";
import { MktNav } from "@/components/marketing/mkt-nav";
import { MktFooter } from "@/components/marketing/mkt-footer";
import { LegalBody } from "@/components/marketing/legal-body";
import { getLegalPage } from "@/domain/queries";

export const metadata: Metadata = { title: "Privacy Policy — Equity Flow Group" };

export default async function PrivacyPage() {
  // Admin override wins; absent means serve the built-in copy below, so a
  // deployment that never edits this still has a complete page.
  const override = await getLegalPage("privacy");

  return (
    <div className="mkt flex-1 overflow-y-auto">
      <MktNav />
      <main className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-2xl font-semibold text-[var(--mkt-ink)]">Privacy Policy</h1>
        <p className="mt-2 text-xs text-[var(--mkt-muted)]">Last updated: template — replace before a real launch.</p>

        <div className="mt-6 rounded-[var(--radius-md)] border border-[var(--warning-border)] bg-[var(--warning-tint)] px-4 py-3 text-[13px] leading-relaxed text-[var(--foreground)]">
          This page is a starting-point template describing what this application actually does with the data it
          collects. It is not a substitute for review by qualified legal counsel — replace it with your own reviewed
          policy before handling real borrower data.
        </div>

        {override ? (
          <LegalBody body={override.body} />
        ) : (
        <div className="mt-8 space-y-6 text-[13.5px] leading-relaxed text-[var(--mkt-body)]">
          <section>
            <h2 className="text-[15px] font-semibold text-[var(--mkt-ink)]">What we collect</h2>
            <p className="mt-2">
              When you submit the intake form, we collect the contact and property information you provide (name,
              phone, email, property address, loan goals, and financial details you choose to share). If you contact
              us afterward — by phone, text, email, or the message box on your status page — we keep a record of
              that contact so a licensed loan officer can follow up.
            </p>
          </section>
          <section>
            <h2 className="text-[15px] font-semibold text-[var(--mkt-ink)]">How we use it</h2>
            <p className="mt-2">
              Your information is used to evaluate your inquiry, route it to a licensed loan officer in your state,
              and follow up with you through the channels you consented to (phone, text, and/or email). We do not
              sell your information.
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
              If you consent to text messages, Equity Flow Group sends you messages about the mortgage inquiry you
              submitted — follow-ups from your loan officer, updates on your file, and replies to questions you ask
              us. This is a conversational programme, not a marketing list: message frequency varies with your
              inquiry, and is typically a small number of messages per week.
            </p>
            <p className="mt-2">
              <strong className="text-[var(--mkt-ink)]">
                We do not sell, rent, or share mobile opt-in information or phone numbers with third parties or
                affiliates for their own marketing purposes.
              </strong>{" "}
              Your number is used only to contact you about your own inquiry, and is shared with service providers
              (such as our telephony carrier) solely to deliver those messages on our behalf.
            </p>
            <p className="mt-2">
              Reply <strong className="text-[var(--mkt-ink)]">STOP</strong> to any message to opt out; we will send
              one confirmation and then stop contacting you on every channel, not only SMS. Reply{" "}
              <strong className="text-[var(--mkt-ink)]">HELP</strong> for assistance, or email{" "}
              <a href="mailto:inquiry@equityflowgroup.com" className="font-medium text-[var(--mkt-primary)] hover:underline">
                inquiry@equityflowgroup.com
              </a>
              . Message and data rates may apply. Carriers are not liable for delayed or undelivered messages.
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
              Questions about this policy or your data can be directed to the loan officer assigned to your inquiry,
              or through the message box on your status page.
            </p>
          </section>
        </div>
        )}
      </main>
      <MktFooter />
    </div>
  );
}
