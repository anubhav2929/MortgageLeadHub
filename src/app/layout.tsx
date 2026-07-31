import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ToastProvider } from "@/components/ui/toast";
import { DemoBanner } from "@/components/layout/demo-banner";
import { getAppUrl } from "@/lib/env";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Deliberately no `robots` override here — the public marketing/`/apply`
// pages SHOULD be indexable at launch. `noindex` is scoped to the internal
// workspace and the borrower status portal instead (see their own layouts),
// not applied site-wide.
export const metadata: Metadata = {
  metadataBase: new URL(getAppUrl()),
  title: "MortgageLeadHub",
  description: "Refinance your rate or access your home equity — a licensed officer follows up within minutes.",
  openGraph: {
    title: "MortgageLeadHub",
    description: "Refinance your rate or access your home equity — a licensed officer follows up within minutes.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex h-dvh flex-col overflow-hidden bg-[var(--background)]">
        <DemoBanner />
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
