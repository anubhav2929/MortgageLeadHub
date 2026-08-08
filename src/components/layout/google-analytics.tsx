import Script from "next/script";

/** GA4 loader — absent measurement ID means no script tags render at all,
 *  matching this app's simulate-by-default pattern for every other vendor
 *  (see src/lib/env.ts). Pageviews only; no lead PII (name, phone, email)
 *  is ever passed into a gtag event — see src/lib/analytics.ts for the
 *  handful of conversion events this app actually fires. */
export function GoogleAnalytics({ measurementId }: { measurementId?: string }) {
  if (!measurementId) return null;
  return (
    <>
      <Script src={`https://www.googletagmanager.com/gtag/js?id=${measurementId}`} strategy="afterInteractive" />
      <Script id="ga4-init" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${measurementId}', { anonymize_ip: true });
        `}
      </Script>
    </>
  );
}
