// Applies a provider delivery-status callback to the attempt it refers to.
//
// This is the half of the outbound story the CRM was missing. Without it,
// every attempt is frozen at the moment we handed it to the provider — SENT
// forever, whether the carrier delivered it, rejected it as spam, or bounced
// it off a disconnected number. The lead list then shows a contact history
// that is optimistic rather than true, and the cadence keeps stepping as if
// each message landed.
//
// The matching key is the provider's own message id, which we store on the
// attempt at send time. Anything we can't match is ignored rather than
// guessed at — an unmatched callback is far more likely to be a stale retry
// for an attempt from a previous deployment than a real record we should
// invent state for.

import {
  classifyFailure,
  isCarrierOptOutFailure,
  isTerminalOutcome,
  mapProviderStatus,
  shouldApplyStatus,
  shouldSuppressChannel,
} from "@/core/deliveryStatus";
import { getDb, newId, nowIso, saveDb } from "@/domain/store";
import { pushEvent } from "@/domain/actions";
import type { AttemptOutcome } from "@/domain/types";

export type DeliveryProvider = "twilio" | "telnyx" | "resend" | "vapi";

export interface DeliveryUpdate {
  providerMessageId: string;
  status: string;
  errorCode?: string;
  errorMessage?: string;
}

export type DeliveryUpdateResult =
  | { applied: true; outcome: AttemptOutcome; leadId: string }
  | { applied: false; reason: "unknown_message" | "unmapped_status" | "out_of_order" };

export async function applyDeliveryUpdate(
  provider: DeliveryProvider,
  update: DeliveryUpdate
): Promise<DeliveryUpdateResult> {
  const outcome = mapProviderStatus(provider, update.status);
  if (!outcome) return { applied: false, reason: "unmapped_status" };

  const db = await getDb();
  const attempt = db.attempts.find((a) => a.providerMessageId === update.providerMessageId);
  if (!attempt) return { applied: false, reason: "unknown_message" };

  // Providers do not guarantee callback ordering, and they retry aggressively.
  // Without this guard a delayed "sent" arriving after "delivered" would walk
  // a settled attempt backwards, and a duplicate retry would re-fire events.
  if (!shouldApplyStatus(attempt.outcome, outcome)) {
    return { applied: false, reason: "out_of_order" };
  }

  const previous = attempt.outcome;
  attempt.outcome = outcome;
  attempt.deliveryUpdatedAt = nowIso();
  if (isTerminalOutcome(outcome) && !attempt.endedAt) attempt.endedAt = nowIso();

  const lead = Array.from(db.leads.values()).find((l) => l.id === attempt.leadId);

  // A carrier-side rejection is a real failure even though our API call
  // succeeded — this is precisely the case that "the provider returned 201"
  // cannot detect, and the reason this webhook exists.
  if (outcome === "UNDELIVERED" || outcome === "FAILED") {
    const failure = classifyFailure(provider, update.errorCode, update.errorMessage ?? `Carrier reported ${update.status}`);
    attempt.failureClass = failure.class;
    attempt.failureMessage = failure.message;

    if (lead) {
      // The message never reached the borrower, so it must not count toward
      // the caps that limit how often they are contacted. The send path
      // optimistically incremented these when the provider accepted it.
      lead.attemptsTotal = Math.max(0, lead.attemptsTotal - 1);
      lead.attemptsToday = Math.max(0, lead.attemptsToday - 1);
      lead.updatedAt = nowIso();

      const person = Array.from(db.people.values()).find((p) => p.leadId === lead.id && p.role === "PRIMARY");
      if (attempt.channel === "SMS" && person?.phoneE164 && isCarrierOptOutFailure(failure)) {
        if (!db.suppressions.has(person.phoneE164)) {
          db.suppressions.set(person.phoneE164, {
            id: newId("supp"),
            phoneE164: person.phoneE164,
            reason: "OPT_OUT_STOP",
            scope: "GLOBAL",
            createdAt: nowIso(),
            expiresAt: null,
          });
        }
        if (!["SUPPRESSED", "CLOSED_WON", "CLOSED_LOST"].includes(lead.state)) {
          lead.state = "SUPPRESSED";
          lead.updatedAt = nowIso();
        }
        await pushEvent({
          leadId: lead.id,
          type: "OPT_OUT_RECEIVED",
          actorType: "PROVIDER",
          actorName: provider,
          channel: "SMS",
          occurredAt: nowIso(),
          payload: { reason: "OPT_OUT_STOP", source: "carrier_delivery_rejection", providerCode: failure.providerCode },
        });
      } else if (shouldSuppressChannel(failure)) {
        if (person) {
          const flag = attempt.channel === "EMAIL" ? "EMAIL_UNDELIVERABLE" : "PHONE_UNDELIVERABLE";
          person.dataQualityFlags = Array.from(new Set([...(person.dataQualityFlags ?? []), flag]));
        }
        const taskId = newId("task");
        db.tasks.set(taskId, {
          id: taskId,
          leadId: lead.id,
          type: "REVIEW_CONTACT_DATA",
          dueAt: nowIso(),
          status: "OPEN",
          assigneeId: lead.assignedOfficerId,
          title: `${attempt.channel === "EMAIL" ? "Email" : "Phone"} undeliverable — carrier rejected the message (${failure.message})`,
        });
      }
    }
  }

  if (lead) {
    await pushEvent({
      leadId: lead.id,
      type: "DELIVERY_UPDATED",
      actorType: "PROVIDER",
      actorName: provider,
      channel: attempt.channel,
      occurredAt: nowIso(),
      payload: { from: previous, to: outcome, providerStatus: update.status, errorCode: update.errorCode },
    });
  }

  await saveDb();
  return { applied: true, outcome, leadId: attempt.leadId };
}
