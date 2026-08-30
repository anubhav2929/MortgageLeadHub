import type { Metadata } from "next";
import { headers } from "next/headers";
import localFont from "next/font/local";
import { ToastProvider } from "@/components/ui/toast";
import { DemoBanner } from "@/components/layout/demo-banner";
import { GoogleAnalytics } from "@/components/layout/google-analytics";
import { getAppUrl, getConfigValue } from "@/lib/runtimeConfig";
import "./globals.css";

const satoshi = localFont({
  src: [
    { path: "./fonts/satoshi-300.woff2", weight: "300", style: "normal" },
    { path: "./fonts/satoshi-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/satoshi-500.woff2", weight: "500", style: "normal" },
    { path: "./fonts/satoshi-700.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-satoshi",
  display: "swap",
  fallback: ["Arial", "sans-serif"],
});

// Deliberately no `robots` override here — the public marketing/`/apply`
// pages SHOULD be indexable at launch. `noindex` is scoped to the internal
// workspace and the borrower status portal instead (see their own layouts),
// not applied site-wide.
export async function generateMetadata(): Promise<Metadata> {
  const appUrl = await getAppUrl();
  return {
    metadataBase: new URL(appUrl),
    title: { default: "Mortgage Refinance & Home Equity Guidance | Equity Flow Group", template: "%s | Equity Flow Group" },
    description: "Refinance your rate or access your home equity — a licensed officer follows up within minutes.",
    applicationName: "Equity Flow Group",
    category: "finance",
    verification: { google: await getConfigValue("GOOGLE_SITE_VERIFICATION") },
    manifest: "/manifest.webmanifest",
    openGraph: {
      title: "Mortgage Refinance & Home Equity Guidance | Equity Flow Group",
      description: "Refinance your rate or access your home equity — a licensed officer follows up within minutes.",
      type: "website",
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const [measurementId, metaPixelId, appUrl] = await Promise.all([
    getConfigValue("NEXT_PUBLIC_GA_MEASUREMENT_ID"),
    getConfigValue("NEXT_PUBLIC_META_PIXEL_ID"),
    getAppUrl(),
  ]);
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Organization", "@id": `${appUrl}#organization`, name: "Equity Flow Group", url: appUrl, logo: `${appUrl}/brand/logo-primary.png` },
      { "@type": "FinancialService", "@id": `${appUrl}#financial-service`, name: "Equity Flow Group", url: appUrl, description: "Mortgage refinance and home-equity education and inquiry routing to licensed loan officers.", areaServed: "US", parentOrganization: { "@id": `${appUrl}#organization` } },
    ],
  };
  return (
    <html lang="en" className={`${satoshi.variable} h-full antialiased`}>
      <body className="flex h-dvh flex-col overflow-hidden bg-[var(--background)]">
        <script nonce={nonce} type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replaceAll("<", "\\u003c") }} />
        <GoogleAnalytics measurementId={measurementId} metaPixelId={metaPixelId} />
        <DemoBanner />
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
