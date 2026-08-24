import { NextResponse } from "next/server";
import { z } from "zod";
import { consumeRateLimit } from "@/domain/rateLimit";
import { getDb } from "@/domain/store";
import { getConfigValue } from "@/lib/runtimeConfig";
import { getRequestContext } from "@/lib/requestContext";
import { GENERIC_ANALYTICS_EVENTS } from "@/core/analyticsPrivacy";

const schema = z.object({ event: z.enum(GENERIC_ANALYTICS_EVENTS), eventId: z.uuid() }).strict();

export async function POST(request: Request) {
  const consent = request.headers.get("cookie")?.includes("mlh_analytics_consent=granted");
  if (!consent) return NextResponse.json({ ok: true, suppressed: true });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid analytics event" }, { status: 400 });
  const context = await getRequestContext();
  const throttle = await consumeRateLimit({ scope: "analytics-event", subject: context.ipAddress, limit: 120, windowSeconds: 60 });
  if (!throttle.allowed) return NextResponse.json({ ok: false }, { status: 429 });
  const db = await getDb();
  if (db.config.featureFlags?.metaCapi !== true) return NextResponse.json({ ok: true, disabled: true });
  const [pixelId, token, graphVersion, appUrl] = await Promise.all([
    getConfigValue("META_PIXEL_ID"), getConfigValue("META_CAPI_ACCESS_TOKEN"), getConfigValue("META_GRAPH_API_VERSION"), getConfigValue("APP_URL"),
  ]);
  if (!pixelId || !token || !graphVersion || !/^v\d+\.\d+$/.test(graphVersion)) return NextResponse.json({ ok: true, disabled: true });
  const referer = request.headers.get("referer");
  let sourceUrl: string | undefined;
  try {
    if (referer) {
      const url = new URL(referer);
      const canonicalOrigin = appUrl ? new URL(appUrl).origin : new URL(request.url).origin;
      if (url.origin === canonicalOrigin && (url.pathname === "/apply" || url.pathname === "/" || url.pathname.startsWith("/tools"))) sourceUrl = `${canonicalOrigin}${url.pathname}`;
    }
  } catch {
    sourceUrl = undefined;
  }
  const response = await fetch(`https://graph.facebook.com/${graphVersion}/${encodeURIComponent(pixelId)}/events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ access_token: token, data: [{
      event_name: parsed.data.event,
      event_time: Math.floor(Date.now() / 1000),
      event_id: parsed.data.eventId,
      action_source: "website",
      ...(sourceUrl ? { event_source_url: sourceUrl } : {}),
      user_data: { client_user_agent: context.userAgent },
    }] }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    console.error(`[meta-capi] delivery failed (${response.status})`);
    return NextResponse.json({ ok: false }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
