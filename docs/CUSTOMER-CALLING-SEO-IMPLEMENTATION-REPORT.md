# Equity Flow Group calling-center and SEO implementation report

> **Release-status update (August 24, 2026):** production code is deployed at `https://www.equityflowgroup.com`. The database backup, migrations `001`–`006`, and normalized reconciliation are complete. Live outreach remains gated until provider/account configuration, scheduler setup, carrier/legal approvals, and approved-number UAT are recorded. See [`CRM-FINAL-DEPLOYMENT-AUDIT.md`](CRM-FINAL-DEPLOYMENT-AUDIT.md).

Prepared: August 24, 2026  
Audience: customer stakeholders, lending operations, marketing, compliance, and technical account owners

## Executive summary

The CRM now supports a phone-transfer-first calling workflow and an operator-controlled back-to-back calling center. Team members can filter leads, select up to 50 authorized contacts, create an ordered call list, and work it one borrower at a time. Administrators may additionally enable automated sequential advancement after approved-number UAT. No bulk action bypasses consent, suppression, quiet hours, attempt limits, licensing, provider readiness, or duplicate-call protection.

The public website now has a complete technical SEO foundation, crawlable internal-link architecture, original mortgage education pages, page-specific metadata, canonical URLs, sitemap/robots controls, organization/site/article/breadcrumb structured data, privacy-limited analytics, and Search Console verification support. “AI SEO” uses the same people-first, indexable, source-backed content foundation recommended by Google for AI Overviews and AI Mode; no unsupported special AI markup has been added.

## 1. How calling worked before this tranche

- A team member could call one lead from the lead detail screen.
- PolicyGate checked consent, suppression, borrower-local contact hours, attempt limits, and lead state.
- Mechanical preflight rejected missing/malformed numbers, unavailable providers, duplicate active calls, and known provider misconfiguration before spending a provider attempt.
- Vapi was the preferred conversational channel and received a restricted, server-owned lead-context snapshot. Twilio/Telnyx announcement calls remained a labelled manual fallback only.
- Live calls appeared in the Call Centre with queued, ringing, connected, and ended states; transcripts and intervention controls were available without exposing provider bearer URLs.
- Automated cadence could place a conversational voice step only when the voice agent was ready. It would downgrade rather than place an unattended one-way robocall.

## 2. Calling-center improvements delivered

### Multi-select call lists

- Admins and officers can select contacts directly from the desktop or mobile lead list.
- A call list accepts no more than 50 unique leads.
- Every selected lead is re-authorized on the server; client selection is never treated as permission.
- The original filtered/sorted order becomes the dialing order.
- Each queue item retains its own pending, calling, completed, blocked, failed, or skipped result.

### Operator-advanced back-to-back calling

- “Create back-to-back call list” creates a recoverable session in the Call Centre.
- “Dial next” performs a fresh PolicyGate and provider preflight immediately before the call.
- The next lead cannot be dialed while the current conversational call is ringing or connected.
- Operators can pause, resume, skip the next lead, or stop the remaining list.
- Blocked leads remain visible with the reason instead of disappearing from operational totals.

### Automated sequential calling

- Automatic lists are admin-only and controlled by the `automatedPowerDialer` rollout flag, which defaults off.
- The scheduled worker advances at most one call at a time across automated call lists.
- An answered call is not considered settled until its conversation has actually ended.
- The worker rechecks PolicyGate immediately before every dial and records blocked or failed results individually.
- The worker is triggered by the protected cadence/processing cron routes and inherits their lease, authentication, recovery, and audit model.
- This is a progressive/sequential dialer, not a predictive dialer: it does not dial multiple borrowers hoping an officer becomes available.

### Correctness improvements

- Fixed manual-call accounting so one call consumes one attempt. Previously the attempt counters advanced at both call start and call wrap-up.
- Session and queue state survive page refreshes and are included in additive database migrations.
- Power-dial creation, advancement, pause/resume, skip, cancellation, and automated advancement are audited.
- All calling rollout flags remain off by default until internal testing and customer UAT are recorded.

## 3. How to use the calling center

1. Configure and verify Vapi, Telnyx/Twilio, signed webhooks, `CRON_SECRET`, and the production database.
2. In **Workspace → Leads**, filter the desired working set.
3. Select up to 50 leads using the row checkboxes.
4. Choose **Create back-to-back call list** for operator advancement.
5. Open **Workspace → Call centre** and choose **Dial next**.
6. Monitor ringing/connected state and the live transcript. Complete or end the call before advancing.
7. Use pause, resume, skip, and stop controls as needed.
8. For automatic sequential UAT, an administrator enables **Automated sequential power dialer** under Admin settings, creates an automatic list, and verifies the protected worker runs every minute.

Before production activation, test only approved numbers and prove: consent allow/deny, STOP suppression, borrower timezone/quiet hours, one-call concurrency, provider outage behavior, busy/no-answer/voicemail, warm transfer, callback fallback, pause/resume, duplicate worker execution, and session recovery after redeployment.

## 4. Technical SEO delivered

- Unique title and meta description for every public commercial/resource/calculator page.
- Self-referencing canonical URL for every indexable page; the global homepage canonical was removed so it cannot collapse child pages into `/`.
- Open Graph and Twitter card metadata with an application-generated social image.
- Root sitemap containing only canonical, indexable public URLs with stable modification dates and priorities.
- Robots rules that allow public content and exclude workspace, API, authentication, status, reset, invitation, and unsubscribe routes.
- Search Console HTML-token support through `GOOGLE_SITE_VERIFICATION`.
- `Organization` and `FinancialService` structured data matching visible company identity.
- Homepage `WebSite` structured data for site-name understanding.
- `Article` and `BreadcrumbList` structured data on mortgage guides, with visible matching breadcrumbs, publisher, review attribution, and update date.
- Web application manifest, crawlable server-rendered text, descriptive headings, mobile navigation, and stable semantic landmarks.
- Consent-aware GA4 and Meta analytics with generic-event allowlists and no mortgage, property, credit, transcript, qualification, or contact parameters.

## 5. Content and internal linking delivered

New public resource architecture:

- `/mortgage-resources` — learning-center hub.
- `/mortgage-refinance` — definition, reasons, break-even concept, Loan Estimate comparison, and related options.
- `/cash-out-refinance` — mechanics, cost/risk questions, and alternatives.
- `/home-equity-options` — visible comparison of cash-out refinance, home equity loan, and HELOC.
- Existing refinance, cash-out, DTI, and payoff calculators remain individual indexable pages.

The homepage, global navigation, footer, calculator pages, resource hub, and guide bodies now form a crawlable contextual-link graph. Important pages are no longer dependent on sitemap-only discovery.

Content is answer-first and uses plain-language definitions, decision questions, comparisons, limitations, source links, and visible “informational—not an offer or personalized advice” boundaries. High-stakes claims link to independent CFPB consumer material.

## 6. AI-search optimization

Google states that AI Overviews and AI Mode use the normal Search index and require no special AI schema, AI text file, or content rewrite. Accordingly, the site was optimized for retrievability and trustworthy answers rather than keyword stuffing:

- Important facts are present as server-rendered text.
- Pages answer one clear user intent and link to adjacent questions.
- Headings, summaries, comparison tables, and key takeaways make the subject and relationships explicit.
- Structured data matches visible content.
- Sources, review ownership, date, limitations, and consumer-protection context improve trust signals for a financial/YMYL topic.
- Canonicals, crawl controls, internal links, and sitemap entries give search systems consistent URL signals.

Official implementation references:

- Google AI features: https://developers.google.com/search/docs/appearance/ai-features
- Google generative-AI optimization guidance: https://developers.google.com/search/docs/fundamentals/ai-optimization-guide
- Sitemap guidance: https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap
- Canonicalization: https://developers.google.com/search/docs/crawling-indexing/canonicalization
- Breadcrumb structured data: https://developers.google.com/search/docs/appearance/structured-data/breadcrumb
- Core Web Vitals: https://developers.google.com/search/docs/appearance/core-web-vitals

## 7. Search Console and analytics connection checklist

1. Create or use an Aldrish-controlled Google account and add a Domain property in Search Console.
2. Prefer DNS TXT verification at the authoritative DNS provider. If HTML-token verification is used, set `GOOGLE_SITE_VERIFICATION` in the deployment environment and redeploy.
3. Confirm the canonical production host redirects all HTTP and alternate-host traffic to one HTTPS hostname.
4. Submit `https://<production-domain>/sitemap.xml` in Search Console.
5. Inspect the homepage, resource hub, each guide, and each calculator with URL Inspection; request indexing after the production launch.
6. Test guide markup in Google Rich Results Test and Schema Markup Validator. Structured data creates eligibility, not guaranteed presentation.
7. Connect GA4 and Search Console, keeping analytics consent-aware.
8. Monitor Page indexing, HTTPS, Manual actions, Security issues, Core Web Vitals, crawl statistics, and search performance.
9. Replace any placeholder NMLS/company details before indexing and ensure legal pages match actual business practices.
10. Review Search Console monthly and after every substantial route, canonical, redirect, or content change.

## 8. External work still required

- Database backup, migrations `001`–`006`, and snapshot reconciliation are complete; retain the encrypted backup under the customer-controlled recovery policy.
- Upgrade the Vercel project from Hobby or configure an external scheduler for the one-minute webhook/outbox worker and five-minute cadence worker. The protected endpoints remain deployed; unsupported sub-daily Hobby cron registration was removed.
- Complete live provider configuration, approved-number UAT, 10DLC/carrier approval, and feature-flag acceptance evidence.
- Supply final company NMLS, address, telephone, logo, and approved social profiles before adding them to Organization markup.
- Verify the production domain in Search Console and submit the sitemap.
- Run field Core Web Vitals monitoring after real traffic exists; lab/build success cannot prove field CWV.
- Continue publishing genuinely useful, reviewed mortgage content. Code cannot guarantee crawling, indexing, ranking, rich results, or AI Overview inclusion.

## 9. Acceptance evidence

Automated verification covers dialing order, active-call settlement protection, skipped/blocked/failed progress accounting, qualification, timezone/DST behavior, signed webhooks, analytics redaction, valuation behavior, and existing CRM workflows.

Local implementation evidence recorded August 24, 2026:

- TypeScript typecheck: passed.
- ESLint: passed.
- Vitest: 47 files and 571 tests passed.
- Next.js webpack production build: passed; 44 application routes plus proxy compiled/generated.
- Production dependency audit: zero known advisories.
- Vercel production build: passed with 44 application routes plus proxy and is served at `https://www.equityflowgroup.com`.
- Data-safety verification: no migration, seed, password setup, deletion, production promotion, or live-provider operation was run.
- Migration/script syntax and `git diff --check`: passed.
- Browser smoke test: `/mortgage-resources` and `/mortgage-refinance` returned 200, rendered expected H1/internal links/canonicals/descriptions, exposed valid parseable Organization, FinancialService, Article, and BreadcrumbList JSON-LD, and produced no browser console errors.
- Private route boundary: `/workspace/leads` redirected to `/login` and did not expose workspace content.

These results verify the code and local rendered behavior. They do not replace production migration, provider UAT, Search Console inspection, rich-results validation against the deployed domain, or field Core Web Vitals measurement.
