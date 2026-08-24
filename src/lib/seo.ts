import type { Metadata } from "next";
import { getAppUrl } from "@/lib/env";

export const SITE_NAME = "Equity Flow Group";
export const DEFAULT_SOCIAL_IMAGE = "/opengraph-image";

export function seoMetadata(input: {
  title: string;
  description: string;
  path: string;
  keywords?: string[];
}): Metadata {
  const canonical = input.path === "/" ? "/" : input.path.replace(/\/$/, "");
  return {
    title: { absolute: input.title },
    description: input.description,
    keywords: input.keywords,
    alternates: { canonical },
    robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1, "max-video-preview": -1 } },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      title: input.title,
      description: input.description,
      url: canonical,
      images: [{ url: DEFAULT_SOCIAL_IMAGE, width: 1200, height: 630, alt: `${SITE_NAME} mortgage guidance` }],
    },
    twitter: { card: "summary_large_image", title: input.title, description: input.description, images: [DEFAULT_SOCIAL_IMAGE] },
  };
}

export function absoluteUrl(path: string): string {
  return new URL(path, getAppUrl()).toString();
}

export function breadcrumbJsonLd(items: Array<{ name: string; path: string }>) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}

export function articleJsonLd(input: { headline: string; description: string; path: string; dateModified?: string }) {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: input.headline,
    description: input.description,
    mainEntityOfPage: absoluteUrl(input.path),
    datePublished: "2026-08-24",
    dateModified: input.dateModified ?? "2026-08-24",
    author: { "@type": "Organization", name: SITE_NAME, url: absoluteUrl("/") },
    publisher: { "@type": "Organization", name: SITE_NAME, url: absoluteUrl("/") },
  };
}
