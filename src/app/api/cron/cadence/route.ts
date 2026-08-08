// Cron-triggered endpoint that actually runs the automated cadence engine
// (src/domain/cadenceEngine.ts). Point any scheduler at this:
// - Vercel Cron (vercel.json) — defaults to once daily, the Hobby-tier
//   ceiling. Upgrade to Pro (or use an external pinger below) for tighter
//   cadence-step timing.
// - An external pinger (cron-job.org, a GitHub Actions scheduled workflow,
//   etc.) hitting this URL on whatever interval you want.
//
// Protected by CRON_SECRET — Vercel Cron automatically sends
// `Authorization: Bearer $CRON_SECRET`; an external pinger needs to send the
// same header manually. In production this is REQUIRED, not optional: an
// empty/unset CRON_SECRET fails closed (401) rather than leaving the
// endpoint — which places real calls/texts — open to anyone who finds the
// URL. Only local dev (no CRON_SECRET at all) skips the check.

import { NextResponse } from "next/server";
import { runCadenceTick } from "@/domain/cadenceEngine";
import { purgeStaleIntakeDrafts } from "@/domain/queries";
import { safeCompare } from "@/core/auth";
import { env } from "@/lib/env";

const isProduction = process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";

export const maxDuration = 60;

export async function GET(request: Request) {
  if (isProduction && !env.CRON_SECRET) {
    console.error("[cadence-cron] CRON_SECRET is not set in production — refusing to run.");
    return NextResponse.json({ ok: false, error: "CRON_SECRET is not configured" }, { status: 401 });
  }

  if (env.CRON_SECRET) {
    const auth = request.headers.get("authorization") ?? "";
    if (!safeCompare(auth, `Bearer ${env.CRON_SECRET}`)) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
  }

  const summary = await runCadenceTick();
  console.log(`[cadence-engine] processed=${summary.processed} delivered=${summary.delivered} blocked=${summary.blocked} exhausted=${summary.exhausted} errors=${summary.errors.length}`);

  // Piggybacks on the same scheduled trigger rather than a second cron job —
  // pre-consent draft PII (src/domain/types.ts IntakeDraft) shouldn't outlive
  // its retention window just because nobody wired up a dedicated job for it.
  const purgedDrafts = await purgeStaleIntakeDrafts();
  if (purgedDrafts > 0) console.log(`[intake-drafts] purged ${purgedDrafts} draft(s) past retention`);

  return NextResponse.json({ ok: true, ...summary, purgedDrafts });
}
