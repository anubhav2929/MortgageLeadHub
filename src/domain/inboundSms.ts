// Ingests an inbound SMS: opt-outs, resubscribes, help requests, and ordinary
// borrower replies.
//
// This closes two gaps at once. The legal one: "Reply STOP to opt out" is in
// the consent text the borrower agreed to and in the privacy policy, but with
// no inbound webhook a STOP reply never reached us — the carrier blocked that
// one channel while the cadence carried on calling and emailing. The product
// one: borrower text replies were the only channel missing from the unified
// conversation thread, so the AI agent and the officer both saw a half
// conversation.

import { alreadyProcessed } from "@/core/idempotency";
import {
  classifyInboundMessage,
  looksLikeOptOutPhrase,
  mayResubscribe,
  OPT_OUT_CONFIRMATION_TEXT,
  HELP_REPLY_TEXT,
} from "@/core/inboundMessage";
import { normalizePhone } from "@/core/intakeNormalization";
import { sendSms } from "@/adapters/sms";
import { pushEvent } from "@/domain/actions";
import { getDb, refreshDb, newId, nowIso, saveDb } from "@/domain/store";
import type { Lead, Person } from "@/domain/types";

export interface InboundSmsInput {
  from: string;
  body: string;
  providerMessageId?: string;
}

export type InboundSmsOutcome =
  | { handled: true; intent: string; leadsAffected: number }
  | { handled: false; reason: "unparseable" | "unknown_number" | "duplicate" };

/** Every lead whose primary contact uses this number. One person can have
 *  several inquiries over time, and an opt-out applies to all of them. */
function leadsForPhone(
  db: Awaited<ReturnType<typeof getDb>>,
  phoneE164: string
): { lead: Lead; person: Person }[] {
  const out: { lead: Lead; person: Person }[] = [];
  for (const person of db.people.values()) {
    if (person.phoneE164 !== phoneE164 || person.role !== "PRIMARY") continue;
    const lead = db.leads.get(person.leadId);
    if (lead) out.push({ lead, person });
  }
  return out;
}

export async function ingestInboundSms(input: InboundSmsInput): Promise<InboundSmsOutcome> {
  // Telnyx delivers at-least-once. Without this a retried delivery becomes a
  // second borrower message in the thread — and, for a STOP, a second
  // confirmation SMS to someone who has just asked us to stop texting them.
  if (input.providerMessageId && alreadyProcessed(`sms-in:${input.providerMessageId}`)) {
    return { handled: false, reason: "duplicate" };
  }

  const phone = normalizePhone(input.from);
  if (!phone || !input.body?.trim()) return { handled: false, reason: "unparseable" };

  const db = await refreshDb();
  const intent = classifyInboundMessage(input.body);
  const matches = leadsForPhone(db, phone);

  // ---- OPT_OUT --------------------------------------------------------
  // Suppress the number itself, not just the leads we can match. Someone can
  // reply STOP from a number we hold under a lead we failed to match, and the
  // safe direction is always "stop contacting this number".
  if (intent === "OPT_OUT") {
    if (!db.suppressions.has(phone)) {
      db.suppressions.set(phone, {
        id: newId("supp"),
        phoneE164: phone,
        reason: "OPT_OUT_STOP",
        scope: "GLOBAL",
        createdAt: nowIso(),
        expiresAt: null,
      });
    }

    for (const { lead } of matches) {
      if (!["SUPPRESSED", "CLOSED_WON", "CLOSED_LOST"].includes(lead.state)) {
        lead.state = "SUPPRESSED";
        lead.updatedAt = nowIso();
      }
      await pushEvent({
        leadId: lead.id,
        type: "OPT_OUT_RECEIVED",
        actorType: "BORROWER",
        channel: "SMS",
        occurredAt: nowIso(),
        payload: { reason: "OPT_OUT_STOP", source: "sms_stop_reply", body: input.body.trim() },
      });
    }

    // Carriers require exactly one confirmation and nothing after it. This is
    // sent directly rather than through PolicyGate, which would now (rightly)
    // refuse it — the suppression we just wrote is what it would refuse on.
    await sendSms({ to: phone, body: OPT_OUT_CONFIRMATION_TEXT, idempotencyKey: newId("idem") });

    saveDb();
    return { handled: true, intent, leadsAffected: matches.length };
  }

  // ---- OPT_IN ---------------------------------------------------------
  // Only lifts the borrower's own STOP. A DNC match, complaint, or litigation
  // hold was placed by someone else for reasons a text message cannot undo.
  if (intent === "OPT_IN") {
    const existing = db.suppressions.get(phone);
    if (existing && mayResubscribe(existing.reason)) {
      db.suppressions.delete(phone);
      for (const { lead } of matches) {
        await pushEvent({
          leadId: lead.id,
          type: "SUPPRESSION_LIFTED",
          actorType: "BORROWER",
          channel: "SMS",
          occurredAt: nowIso(),
          payload: { source: "sms_start_reply" },
        });
      }
    }
    saveDb();
    return { handled: true, intent, leadsAffected: matches.length };
  }

  // ---- HELP -----------------------------------------------------------
  if (intent === "HELP") {
    await sendSms({ to: phone, body: HELP_REPLY_TEXT, idempotencyKey: newId("idem") });
    saveDb();
    return { handled: true, intent, leadsAffected: matches.length };
  }

  // ---- MESSAGE --------------------------------------------------------
  // An ordinary reply. Recorded as a borrower-authored note so it lands in the
  // unified thread alongside calls and emails — which is what lets the next AI
  // touch answer what they actually said.
  if (matches.length === 0) return { handled: false, reason: "unknown_number" };

  for (const { lead } of matches) {
    db.notes.push({
      id: newId("note"),
      leadId: lead.id,
      authorId: "borrower",
      authorName: "Borrower (via text reply)",
      body: input.body.trim(),
      createdAt: nowIso(),
    });

    lead.lastContactAt = nowIso();
    lead.updatedAt = nowIso();

    // A phrase that reads like an opt-out without being an exact keyword is
    // escalated to a human rather than acted on. Auto-suppressing on a fuzzy
    // match would silently kill live leads; ignoring it entirely would leave a
    // borrower who clearly asked us to stop being contacted by the cadence.
    const ambiguousOptOut = looksLikeOptOutPhrase(input.body);
    const taskId = newId("task");
    db.tasks.set(taskId, {
      id: taskId,
      leadId: lead.id,
      type: ambiguousOptOut ? "COMPLAINT" : "BORROWER_MESSAGE",
      dueAt: nowIso(),
      status: "OPEN",
      assigneeId: lead.assignedOfficerId,
      title: ambiguousOptOut
        ? `Possible opt-out by text — review and confirm: "${input.body.trim().slice(0, 60)}"`
        : `Borrower replied by text: "${input.body.trim().slice(0, 60)}"`,
    });

    await pushEvent({
      leadId: lead.id,
      type: ambiguousOptOut ? "ESCALATED" : "NOTE_ADDED",
      actorType: "BORROWER",
      channel: "SMS",
      occurredAt: nowIso(),
      payload: { source: "sms_inbound", ambiguousOptOut },
    });
  }

  saveDb();
  return { handled: true, intent, leadsAffected: matches.length };
}
