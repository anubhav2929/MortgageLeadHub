import { describe, expect, it } from "vitest";
import sitemap from "@/app/sitemap";
import robots from "@/app/robots";
import { seoMetadata } from "@/lib/seo";

describe("public SEO controls", () => {
  it("uses a self-referencing canonical instead of inheriting the homepage", () => {
    const metadata = seoMetadata({ title: "Guide", description: "A useful mortgage guide.", path: "/mortgage-refinance" });
    expect(metadata.alternates?.canonical).toBe("/mortgage-refinance");
    expect(metadata.robots).toMatchObject({ index: true, follow: true });
  });

  it("lists resource and calculator canonicals without private routes", () => {
    const urls = sitemap().map((entry) => entry.url);
    expect(urls.some((url) => url.endsWith("/mortgage-resources"))).toBe(true);
    expect(urls.some((url) => url.endsWith("/home-equity-options"))).toBe(true);
    expect(urls.some((url) => url.includes("/workspace"))).toBe(false);
    expect(urls.some((url) => url.includes("/status"))).toBe(false);
  });

  it("blocks operational and borrower-private route families", () => {
    const rules = robots().rules;
    const first = Array.isArray(rules) ? rules[0] : rules;
    expect(first.disallow).toEqual(expect.arrayContaining(["/workspace/", "/api/", "/status/"]));
  });
});
