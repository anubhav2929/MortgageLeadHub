// Live-call state for the floating widget.
//
// A dedicated endpoint rather than reusing the page. The widget is mounted in
// the workspace layout and must stay current on every screen, including ones
// with no call data of their own — driving it with router.refresh() would
// re-render whatever page the officer happens to be reading, several times a
// minute, for no reason.
//
// Returns only what the widget draws. In particular it never returns the
// provider's control or listen URLs: those are bearer credentials, and this
// response is fetched by the browser.

import { NextResponse } from "next/server";
import { can } from "@/core/rbac";
import { listLiveCalls, syncCallState } from "@/domain/queries";
import { getCurrentUser } from "@/domain/session";

export interface LiveCallSummary {
  conversationId: string;
  leadPublicRef: string;
  borrowerName: string;
  stage: "QUEUED" | "RINGING" | "CONNECTED" | "ENDED";
  startedAt: string;
  turns: number;
  /** Latest line spoken, so the widget can show movement without the transcript. */
  lastLine?: string;
}

export async function GET() {
  const user = await getCurrentUser();
  if (!can({ role: user.role, officerId: user.officerId }, "VIEW_LEAD_PII")) {
    return NextResponse.json({ calls: [] }, { status: 403 });
  }

  // The widget is the most frequent caller, so it drives the sync. Concurrent
  // callers join one pass (core/singleFlight), so the board polling at the
  // same time costs nothing extra.
  try {
    await syncCallState();
  } catch {
    // Stale data beats an error: the widget must never disappear because one
    // provider poll failed.
  }

  const live = await listLiveCalls();
  const calls: LiveCallSummary[] = live.map((e) => {
    const c = e.conversation!;
    const last = c.transcript[c.transcript.length - 1];
    return {
      conversationId: c.id,
      leadPublicRef: e.leadPublicRef,
      borrowerName: e.borrowerName,
      stage: c.callStatus ?? "QUEUED",
      startedAt: c.startedAt,
      turns: c.transcript.length,
      lastLine: last ? `${last.role === "BORROWER" ? e.borrowerName.split(" ")[0] : "Agent"}: ${last.text}` : undefined,
    };
  });

  return NextResponse.json(
    { calls },
    // Never cached: a stale live-call list is the specific thing this exists
    // to prevent.
    { headers: { "Cache-Control": "no-store" } }
  );
}
