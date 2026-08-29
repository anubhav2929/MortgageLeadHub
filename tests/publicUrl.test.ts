import { describe, expect, it } from "vitest";
import { normalizePublicAppUrl, resolvePublicAppUrl } from "@/core/publicUrl";

describe("normalizePublicAppUrl", () => {
  it("repairs the Markdown link value that previously crashed generateMetadata", () => {
    expect(normalizePublicAppUrl("[www.equityflowgroup.com](http://www.equityflowgroup.com)")).toEqual({
      ok: true,
      url: "https://www.equityflowgroup.com",
      changed: true,
    });
  });

  it("accepts a bare domain and canonicalizes it to an HTTPS origin", () => {
    expect(normalizePublicAppUrl("www.equityflowgroup.com/path?source=admin#top")).toEqual({
      ok: true,
      url: "https://www.equityflowgroup.com",
      changed: true,
    });
  });

  it("keeps local development on HTTP", () => {
    expect(normalizePublicAppUrl("http://localhost:3000/settings")).toEqual({
      ok: true,
      url: "http://localhost:3000",
      changed: true,
    });
  });

  it("rejects non-web schemes and credential-bearing origins", () => {
    expect(normalizePublicAppUrl("javascript://example.com").ok).toBe(false);
    expect(normalizePublicAppUrl("https://user:secret@example.com").ok).toBe(false);
  });
});

describe("resolvePublicAppUrl", () => {
  it("prefers the stable Vercel production custom domain over a deployment URL", () => {
    expect(resolvePublicAppUrl({
      vercelProductionUrl: "equityflowgroup.com",
      vercelDeploymentUrl: "mortgage-lead-hub-a1b2.vercel.app",
    })).toMatchObject({
      url: "https://equityflowgroup.com",
      source: "vercel-production",
    });
  });

  it("falls back safely when a legacy configured value is invalid", () => {
    expect(resolvePublicAppUrl({
      configured: "not a valid url !",
      vercelProductionUrl: "equityflowgroup.com",
    })).toMatchObject({
      url: "https://equityflowgroup.com",
      source: "vercel-production",
      configuredInvalid: true,
    });
  });
});
