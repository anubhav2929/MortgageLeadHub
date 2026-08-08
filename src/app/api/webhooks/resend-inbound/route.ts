// Receives Resend's `email.received` webhook for a borrower replying to any
// outreach email — see domain/inboundEmail.ts for the thread-to-lead
// matching logic this hands off to. The webhook body only carries metadata
// (Resend's own limitation, not ours); the full message body is fetched
// separately via their Received Emails API using the email_id.
//
// Setup (see DEPLOY.md): add a webhook in the Resend dashboard for the
// `email.received` event pointing at this URL, and set
// RESEND_INBOUND_WEBHOOK_SECRET to the signing secret it gives you. Resend
// signs webhook requests the same way Svix does — verifySvixSignature
// (core/auth.ts) checks that without needing the `svix` package.

import { NextResponse } from "next/server";
import { ingestInboundEmail } from "@/domain/inboundEmail";
import { verifySvixSignature } from "@/core/auth";
import { capabilities, env } from "@/lib/env";

interface ResendReceivedEvent {
  type: string;
  data?: { email_id?: string };
}

interface ResendReceivedEmail {
  from: string;
  subject: string;
  text: string | null;
  html: string;
}

export async function POST(request: Request) {
  if (!capabilities.hasInboundEmail) {
    return NextResponse.json({ ok: false, error: "Inbound email is not configured" }, { status: 401 });
  }

  const rawBody = await request.text();
  const verified = verifySvixSignature(
    env.RESEND_INBOUND_WEBHOOK_SECRET!,
    {
      id: request.headers.get("svix-id"),
      timestamp: request.headers.get("svix-timestamp"),
      signature: request.headers.get("svix-signature"),
    },
    rawBody
  );
  if (!verified) return NextResponse.json({ ok: false, error: "Invalid signature" }, { status: 401 });

  let event: ResendReceivedEvent;
  try {
    event = JSON.parse(rawBody);
  } catch {
    // Malformed body — 200 so Resend doesn't retry-storm a payload that'll
    // never parse, matching the Vapi webhook's same reasoning.
    return NextResponse.json({ ok: false, error: "Invalid JSON body" });
  }

  const emailId = event.data?.email_id;
  if (event.type !== "email.received" || !emailId) return NextResponse.json({ ok: true });

  const res = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` },
  });
  if (!res.ok) {
    console.error(`[resend-inbound] failed to fetch email ${emailId}: ${res.status} ${await res.text()}`);
    return NextResponse.json({ ok: false, error: "Failed to fetch email content" }, { status: 502 });
  }
  const email = (await res.json()) as ResendReceivedEmail;

  await ingestInboundEmail({
    fromEmail: email.from,
    subject: email.subject,
    // Plain text when Resend extracted it; a bare-HTML reply is rare enough
    // (nearly every client sends multipart) that a naive tag-strip is an
    // acceptable fallback rather than pulling in an HTML parser for it.
    text: email.text ?? email.html.replace(/<[^>]+>/g, " ").trim(),
  });

  return NextResponse.json({ ok: true });
}
