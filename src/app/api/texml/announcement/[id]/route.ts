// Serves the TeXML document Telnyx fetches when an outbound announcement call
// connects.
//
// Why this route exists at all: Twilio's Calls API accepts TwiML inline in the
// same request that places the call, so adapters/voice.ts could stay a single
// round trip. Telnyx TeXML has no inline-content field — it only takes a `Url`
// it will fetch — so the script has to be retrievable over HTTP by the carrier
// a moment later. This is that URL.
//
// Security shape, in order of what actually protects what:
//
//  1. The script is stored server-side and referenced by an unguessable id.
//     Passing the text in the query string would have been simpler and wrong:
//     it would put outbound call scripts into every access log and proxy, and
//     it would let anyone who reached this endpoint make our verified number
//     read out text of their choosing.
//  2. A shared secret is still required, so the id alone is not sufficient.
//  3. Single use. Once fetched, the announcement is consumed — a URL captured
//     from logs cannot be replayed to re-read the script.
//  4. Short TTL, so an unused announcement stops being a live credential.

import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { safeCompare } from "@/core/auth";
import { getDb, saveDb } from "@/domain/store";

/** TeXML is XML — anything interpolated has to be escaped or the document
 *  breaks, and a stray `<` in a borrower's name would silently truncate the
 *  message the carrier reads out. */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function texml(body: string): NextResponse {
  return new NextResponse(`<?xml version="1.0" encoding="UTF-8"?>${body}`, {
    status: 200,
    headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const provided = req.nextUrl.searchParams.get("token") ?? "";
  const db = await getDb();
  const announcement = db.voiceAnnouncements.get(id);
  const suppliedHash = createHash("sha256").update(provided, "utf8").digest("hex");
  if (!announcement?.accessTokenHash || !safeCompare(suppliedHash, announcement.accessTokenHash)) {
    // 404 rather than 401: an unauthenticated caller learns nothing about
    // whether this id exists.
    return new NextResponse("Not found", { status: 404 });
  }

  // Every failure below returns a valid TeXML document rather than an error
  // status. If we 500 here, the carrier drops a call that is already ringing
  // in someone's hand — they answer to silence and a hang-up, which is both a
  // worse experience and, for an unattended call, a worse compliance look
  // than saying something brief and ending cleanly.
  if (!announcement) return texml("<Response><Hangup/></Response>");
  if (announcement.consumedAt) return texml("<Response><Hangup/></Response>");
  if (new Date(announcement.expiresAt).getTime() < Date.now()) {
    return texml("<Response><Hangup/></Response>");
  }

  announcement.consumedAt = new Date().toISOString();
  db.voiceAnnouncements.set(id, announcement);
  await saveDb();

  return texml(
    `<Response><Say voice="Polly.Joanna">${escapeXml(announcement.text)}</Say></Response>`
  );
}

// Telnyx defaults to POST, but a misconfigured TeXML application can be set to
// GET. Serving both means a wrong dropdown in their dashboard doesn't present
// as a dead call with no explanation.
export const GET = POST;
