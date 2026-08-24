# Property Valuation, Lead Discovery, and CRM Navigation Completion Report

**Completion date:** August 24, 2026
**Scope:** Free property evidence, public lead discovery restoration, tab/navigation UX, configuration, and regression verification

## Executive result

The free lead-discovery code was not missing; its server action had been coupled to Reddit OAuth and therefore could no longer reach the existing free Arctic Shift adapter. Retrieval and publishing are now separate. Arctic Shift is restored as the no-auth, read-only source that populates the human-review queue without a Reddit account. Direct Reddit publishing still requires written commercial approval, OAuth, subreddit-rule confirmation, and an explicit human Publish action.

Property valuation is now a multi-source evidence pipeline instead of a single configured endpoint. It normalizes addresses with the US Census Geocoder, uses the no-key ArcGIS public catalog plus optional Brave Search to rank configured official sources, queries multiple allowlisted JSON/ArcGIS record APIs in bounded parallel, time-adjusts recorded sales against the current official FHFA dataset, calculates the value/range/confidence deterministically, and uses RentCast only when the free chain lacks two independent value sources. It never converts a search snippet, Reddit discussion, or LLM response into a property value.

The final lead-detail pass also retires cached legacy `SIMULATED` values. Lead pages replace those records immediately with an explicit insufficient-evidence state and never block rendering on a provider lookup. Administrators can run the real checks from the valuation card, see a stable pending state, and receive a persisted/audited result. Missing or conflicting data produces targeted borrower questions rather than a fabricated value.

CRM tab navigation now changes content optimistically, preserves the URL, reports pending state accessibly, supports arrow/Home/End keyboard navigation, and scrolls horizontally on narrow screens. Route-specific skeletons were added for Leads, Lead Detail, Call Centre, Discovery, Messages, and Tasks.

## What was completed

### Free lead discovery

- Restored Arctic Shift as the primary free, no-auth, read-only discovery source, matching the previously working product behavior.
- Removed the accidental `DISCOVERY_ARCHIVE_APPROVED` runtime gate that blocked existing installations even though Arctic Shift requires no credentials.
- Restored a dedicated **Lead discovery (Arctic Shift)** card in Admin → Integrations with a real connection test.
- Added Arctic Shift as the shared public-conversation search lane inside **Public Search & Property Records** without duplicating its client or treating discussion content as property evidence.
- Added concurrent, failure-isolated health orchestration for Arctic Shift public search and the Census/FHFA/allowlisted property-evidence lane.
- Removed the accidental dependency between retrieval and Reddit publishing.
- Preserved human review, freshness filtering, subreddit scoping, local intent scoring, URL deduplication, and AI-assisted triage.
- Preserved the no-consent boundary: discovered signals are not contactable leads and are never auto-called, auto-texted, auto-emailed, or auto-posted.
- Updated the discovery screen to show Arctic Shift readiness independently from Reddit publishing status.
- Added registry regression coverage so the named, no-key Arctic Shift integration cannot silently disappear again.

### Multi-source free property valuation

- Census address normalization and geocoding remain the first step.
- Added `PROPERTY_PUBLIC_RECORD_SOURCES_JSON` for up to eight public-record adapters.
- Supports:
  - generic JSON address-query APIs;
  - ArcGIS FeatureServer query endpoints;
  - source-specific field maps for assessor value, public estimate, recorded sale, sale date, property type, and year built.
- Added `PROPERTY_RECORD_ALLOWLIST`; every configured endpoint must use HTTPS and have an explicitly allowlisted host.
- Added save-time JSON, size, HTTPS, and host validation in Admin.
- Added optional Brave Search source ranking. Search is used only to prioritize configured official sources. Search results are never fetched automatically and never supply a dollar value.
- Added bounded concurrency and independent failure handling so one county/open-data outage does not cancel other evidence sources.
- Added the live FHFA master HPI JSON dataset with a six-hour in-process cache and retained the administrator-supplied HPI JSON as an outage fallback.
- Replaced evidence-count confidence with independent-source confidence, dispersion, and freshness checks.
- Preserved RentCast as the metered fallback and “insufficient evidence” when both chains fail.
- Added evidence/methodology disclosure to the valuation card, including value, source, weight, observation date, and contextual notes.
- Corrected UI wording from “comparable sales” to “independent value sources.”
- Added unit tests for source caps, ArcGIS field validation, FHFA time adjustment, minimum independent evidence, and deterministic weighting.
- Added a no-key ArcGIS Online catalog discovery pass. It sends only city/state/ZIP, never the street address, and may only reorder sources already approved in the host allowlist.
- Retired all legacy simulated valuation caches and prevented them from being reused.
- Added an Admin-only, centrally authorized **Run checks again** action with visible pending/error/success states, audit activity, a five-per-hour per-lead/provider-cost guard, and route revalidation.
- Removed external provider I/O from lead-page rendering; explicit recalculation owns the network operation and its progress UI.
- Added deterministic clarification prompts for missing address, city, ZIP, borrower estimate, balance, property type, year built, purchase evidence, and material borrower/source conflicts.
- Split borrower-reported value and balance into separately labeled lead fields. Missing balance now says **Not collected**, never `$0`; a reported paid-off `$0` balance remains valid measured data.
- Hide calculated equity and LTV until a borrower-reported balance exists.
- Added property ZIP to public intake, schema validation, lead editing, normalized valuation input, and cache invalidation.
- Property/address/value/balance edits invalidate prior evidence immediately and require a fresh audited check.

### Public intake visual completion

- `/apply` now uses the same sticky marketing navigation and legal footer as the public site.
- Added the homepage hero grid, gradient blooms, secure-inquiry label, explanatory heading, and trust statements around the form.
- Upgraded the intake card to a high-contrast, translucent hero surface with the existing accessible five-step workflow preserved.
- Added a validated ZIP field with postal autocomplete and public-record matching guidance.
- Verified the header, hero, form, footer, intent selection, next-step transition, and ZIP field in a real browser.

### CRM tabs and loading behavior

- Added optimistic URL-backed tab selection and a thin pending progress indicator.
- Added an inline pending indicator on the selected tab without changing button width.
- Added `aria-busy`, live-region status, `tablist`/`tab`/`tabpanel` roles, selection state, control relationships, and keyboard navigation.
- Added horizontal snap/scroll behavior with visible scrollbar support on narrow layouts.
- Added meaningful route skeletons for the primary CRM work areas.
- Stopped the floating live-call monitor from polling its privileged endpoint for roles that cannot view the Call Centre, eliminating repeated expected 403 traffic for read-only users.
- Verified all eight Lead Detail tabs in a rendered browser:
  - Overview
  - Timeline
  - Package
  - Calls
  - Conversation
  - Consent
  - Tasks
  - Notes
- Verified at 390px width that the 823px tab rail remains scrollable inside a 358px viewport and every tab remains present in the accessibility tree.
- Verified no browser console errors during these transitions.

## Administrator setup

For discovery, go to **Admin → Integrations → Lead discovery (Arctic Shift)**. No account, API key, or saved setting is required. Click **Test connection** to make a live read-only health request, then open **Lead Discovery** and click **Run discovery**.

For property valuation, go to **Admin → Integrations → Public Search & Property Records**.

1. Optionally enter `BRAVE_SEARCH_API_KEY`. The valuation chain still uses Census, FHFA, and configured records without this key.
2. Enter every permitted API host in `PROPERTY_RECORD_ALLOWLIST`, comma separated.
3. Enter source definitions in `PROPERTY_PUBLIC_RECORD_SOURCES_JSON`.
4. Click **Save**, then **Test connection**.
5. Go to **Admin → Settings → Production rollout flags** and enable **Free valuation evidence chain** after UAT on the approved address set.

Example generic JSON source:

```json
[
  {
    "label": "Example County Assessor",
    "endpoint": "https://data.examplecounty.gov/api/property",
    "format": "GENERIC_JSON",
    "addressParam": "address",
    "reliability": 0.78,
    "fieldMap": {
      "assessedValue": "result.assessed_value",
      "lastSalePrice": "result.last_sale_price",
      "lastSaleDate": "result.last_sale_date",
      "propertyType": "result.property_type",
      "yearBuilt": "result.year_built"
    }
  }
]
```

Example ArcGIS source:

```json
[
  {
    "label": "Example County ArcGIS Parcels",
    "endpoint": "https://services.arcgis.com/example/ArcGIS/rest/services/Parcels/FeatureServer/0/query",
    "format": "ARCGIS",
    "addressField": "SITE_ADDR",
    "reliability": 0.76,
    "fieldMap": {
      "assessedValue": "TOTAL_VALUE",
      "lastSalePrice": "SALE_PRICE",
      "lastSaleDate": "SALE_DATE",
      "propertyType": "LAND_USE",
      "yearBuilt": "YEAR_BUILT"
    }
  }
]
```

The exact endpoint and field names vary by county. Only use official or contractually permitted APIs, and benchmark them before production activation.

## Compliance boundary

Arctic Shift retrieval is read-only and produces review signals only. Those records have no borrower consent and cannot enter calling, SMS, email, or automated cadence workflows. Reddit OAuth publishing remains separately gated by written commercial approval, a connected account, subreddit-rule confirmation, and an explicit human Publish action.

Search APIs are treated as discovery/ranking tools, not valuation authorities. The application does not scrape listing sites, ingest arbitrary search-result pages, persist search snippets as valuation evidence, or ask an LLM to generate the final value.

## Verification evidence

- TypeScript: passed.
- ESLint: passed.
- Vitest: 50 files, 587 tests passed.
- Rendered browser: all Lead Detail tabs passed; mobile overflow passed; zero console errors.
- Next.js webpack production build: passed, 44 routes generated.
- Turbopack: restricted local environment prevented its helper process from binding a port; this is the same environment limitation recorded previously, not a compile failure. The webpack production compiler completed successfully.

## Files of interest

- `src/adapters/propertyData.ts`
- `src/adapters/leadDiscovery.ts`
- `src/domain/actions.ts`
- `src/core/integrationRegistry.ts`
- `src/domain/integrationActions.ts`
- `src/components/workspace/property-valuation-card.tsx`
- `src/components/ui/url-tabs.tsx`
- `src/components/ui/tabs.tsx`
- `src/components/workspace/route-loading.tsx`
- `tests/propertyValuation.test.ts`
- `tests/arcticShiftIntegration.test.ts`
