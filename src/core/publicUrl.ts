export type PublicUrlSource = "configured" | "vercel-production" | "vercel-deployment" | "localhost";

export type PublicUrlNormalization =
  | { ok: true; url: string; changed: boolean }
  | { ok: false; reason: string };

/**
 * Convert administrator/env input into one canonical application origin.
 *
 * The field is frequently populated by copying a rendered link, which can
 * produce Markdown such as `[www.example.com](http://www.example.com)`.
 * Accept that safely, add a missing scheme, upgrade public origins to HTTPS,
 * and deliberately discard paths/query/hash: provider callbacks and SEO need
 * an origin, not a page URL.
 */
export function normalizePublicAppUrl(raw: string): PublicUrlNormalization {
  let candidate = raw.trim();
  if (!candidate) return { ok: false, reason: "Enter a public domain or URL." };

  const markdownLink = candidate.match(/^\[[^\]]+\]\((https?:\/\/[^\s)]+)\)$/i);
  if (markdownLink) candidate = markdownLink[1];

  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(candidate)) candidate = `https://${candidate}`;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { ok: false, reason: "Enter a valid domain, such as https://www.example.com." };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: "The public app URL must use HTTPS." };
  }
  if (!parsed.hostname || parsed.username || parsed.password) {
    return { ok: false, reason: "The public app URL must be a domain without credentials." };
  }

  const local = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1";
  if (!local) parsed.protocol = "https:";
  const url = parsed.origin;
  return { ok: true, url, changed: url !== raw.trim() };
}

export interface PublicUrlResolution {
  url: string;
  source: PublicUrlSource;
  configuredInvalid: boolean;
  configuredError?: string;
}

/** Resolve the stable production origin. Vercel's project production URL is
 * preferred over VERCEL_URL because the latter is the generated URL for one
 * deployment and changes across previews/deployments. */
export function resolvePublicAppUrl(input: {
  configured?: string;
  vercelProductionUrl?: string;
  vercelDeploymentUrl?: string;
}): PublicUrlResolution {
  let configuredInvalid = false;
  let configuredError: string | undefined;
  if (input.configured?.trim()) {
    const normalized = normalizePublicAppUrl(input.configured);
    if (normalized.ok) return { url: normalized.url, source: "configured", configuredInvalid: false };
    configuredInvalid = true;
    configuredError = normalized.reason;
  }

  const fallbacks: Array<{ value?: string; source: PublicUrlSource }> = [
    { value: input.vercelProductionUrl, source: "vercel-production" },
    { value: input.vercelDeploymentUrl, source: "vercel-deployment" },
  ];
  for (const fallback of fallbacks) {
    if (!fallback.value) continue;
    const normalized = normalizePublicAppUrl(fallback.value);
    if (normalized.ok) return { url: normalized.url, source: fallback.source, configuredInvalid, configuredError };
  }

  return { url: "http://localhost:3000", source: "localhost", configuredInvalid, configuredError };
}
