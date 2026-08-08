// Thread-to-lead matching for inbound email replies — SPEC.md task-list
// "Inbound Email" item. Not a server action (no "use server"): this is
// webhook-invoked domain logic, same shape as cadenceEngine.ts, called from
// src/app/api/webhooks/resend-inbound/route.ts rather than from the UI.
//
// Matching is by the sender's email address against db.people — a borrower
// who replies to any outreach email we sent is reachable this way without
// needing a reply-to alias or a token in the subject line. An email from an
// address that matches no lead is logged and dropped; there's nothing to
// attach it to and no consent-gated pipeline it could safely enter (compare
// domain/types.ts IntakeDraft / DiscoveredSignal for the same reasoning).

import { autoAssignOfficer, pushEvent } from "@/domain/actions";
import { getDb, newId, nowIso, saveDb } from "@/domain/store";

export interface InboundEmailInput {
  fromEmail: string;
  subject: string;
  text: string;
}

// Resend's documented `from` shape is a bare address, but mail clients
// (and possibly Resend itself) sometimes send "Display Name <addr>" —
// pull out just the address so matching against person.email is reliable
// either way.
function extractEmailAddress(raw: string): string {
  const match = raw.match(/<([^>]+)>/);
  return (match ? match[1] : raw).trim().toLowerCase();
}

export async function ingestInboundEmail(input: InboundEmailInput): Promise<{ matched: boolean }> {
  const fromEmail = extractEmailAddress(input.fromEmail);
  const db = await getDb();

  const person = Array.from(db.people.values()).find((p) => p.email.trim().toLowerCase() === fromEmail);
  if (!person) {
    console.log(`[inbound-email] no lead matches sender ${fromEmail} — dropped`);
    return { matched: false };
  }

  const lead = db.leads.get(person.leadId);
  if (!lead) {
    console.log(`[inbound-email] person ${person.id} has no lead record — dropped`);
    return { matched: false };
  }

  const body = input.text.trim();
  const preview = body.length > 2000 ? `${body.slice(0, 2000)}…` : body;

  db.notes.push({
    id: newId("note"),
    leadId: lead.id,
    authorId: "borrower",
    authorName: "Borrower (via email reply)",
    body: preview || "(empty message body)",
    createdAt: nowIso(),
  });

  const taskId = newId("task");
  db.tasks.set(taskId, {
    id: taskId,
    leadId: lead.id,
    type: "INBOUND_EMAIL",
    dueAt: nowIso(),
    status: "OPEN",
    title: `Email reply: "${input.subject.length > 80 ? `${input.subject.slice(0, 80)}…` : input.subject}"`,
  });

  await pushEvent({ leadId: lead.id, type: "NOTE_ADDED", actorType: "BORROWER", occurredAt: nowIso(), channel: "EMAIL", payload: { source: "inbound_email" } });
  await autoAssignOfficer(db, lead, "inbound_email");

  saveDb();
  return { matched: true };
}
