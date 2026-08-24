import type { MetadataRoute } from "next";
import { getAppUrl } from "@/lib/env";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = getAppUrl();
  return ["", "/mortgage-resources", "/mortgage-refinance", "/cash-out-refinance", "/home-equity-options", "/apply", "/tools", "/tools/refinance-calculator", "/tools/cash-out-calculator", "/tools/dti-calculator", "/tools/mortgage-payoff-calculator"].map((path) => ({
    url: `${base}${path}`,
    changeFrequency: path === "" ? "weekly" as const : "monthly" as const,
    priority: path === "" ? 1 : path === "/apply" ? 0.9 : path.includes("mortgage") || path.includes("refinance") || path.includes("equity") ? 0.8 : 0.6,
    lastModified: new Date("2026-08-24T00:00:00.000Z"),
  }));
}
