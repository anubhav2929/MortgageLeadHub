"use server";

// The one entry point for a soft credit pull. Every caller — intake, the
// post-submit chat, the officer workspace — comes through here, so there is
// exactly one place where the FCRA gate is enforced and exactly one place to
// audit whether we were permitted to run an inquiry.

import { runSoftCreditPull, type SoftPullInput } from "@/adapters/creditCheck";
import {
  evaluateCreditGate,
  FCRA_CREDIT_AUTHORIZATION_TEXT,
  FCRA_CREDIT_AUTHORIZATION_VERSION,
  type CreditPullTrigger,
} from "@/core/creditGate";
import { getDb, newId, nowIso, saveDb } from "@/domain/store";
import { pushEvent } from "@/domain/actions";
import type { CreditPullResult, Lead } from "@/domain/types";

export interface CreditPullOutcome {
  ok: boolean;
  message: string;
  band?: string;
  simulated?: boolean;
}

/**
 * Record the borrower's FCRA authorisation. Stores the exact wording shown on
 * screen — a version number alone cannot answer "what did this consumer
 * actually agree to" two years from now, which is the question that matters.
 */
export async function recordCreditConsent(
  leadId: string,
  granted: boolean,
  trigger: CreditPullTrigger,
  context: { ipAddress?: string; userAgent?: string } = {}
): Promise<void> {
  const db = await getDb();
  db.creditConsents.push({
    id: newId("fcra"),
    leadId,
    granted,
    exactTextSnapshot: FCRA_CREDIT_AUTHORIZATION_TEXT,
    textVersion: FCRA_CREDIT_AUTHORIZATION_VERSION,
    capturedAt: nowIso(),
    trigger,
    ipAddress: context.ipAddress ?? "unknown",
    userAgent: context.userAgent ?? "unknown",
  });
  saveDb();
}

/**
 * Run a soft pull for a lead, if and only if the gate allows it.
 *
 * Returns a plain outcome rather than throwing: a refused pull is a normal
 * business result (no consent, low intent, already pulled), not an error.
 */
export async function runGatedSoftPull(
  lead: Lead,
  trigger: CreditPullTrigger
): Promise<CreditPullOutcome> {
  const db = await getDb();
  const person = Array.from(db.people.values()).find((p) => p.leadId === lead.id && p.role === "PRIMARY");

  // Consent is read from the stored record, never from a caller's argument —
  // otherwise any call site could assert authorisation it didn't have.
  const consent = db.creditConsents
    .filter((c) => c.leadId === lead.id)
    .sort((a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime())[0];

  const decision = evaluateCreditGate({
    trigger,
    hasFcraConsent: Boolean(consent?.granted),
    firstName: person?.firstName,
    lastName: person?.lastName,
    addressLine1: lead.addressLine1,
    city: lead.city,
    stateCode: lead.stateCode,
    intent: lead.intent,
    goal: lead.goal,
    timeline: lead.timeline,
    missedPayments: lead.missedPayments,
    previousPullCount: db.creditPulls.filter((p) => p.leadId === lead.id).length,
  });

  if (!decision.allowed) {
    await pushEvent({
      leadId: lead.id,
      type: "CREDIT_PULL_BLOCKED",
      actorType: "SYSTEM",
      occurredAt: nowIso(),
      payload: { trigger, blocker: decision.blocker, reason: decision.reason },
    });
    saveDb();
    return { ok: false, message: decision.reason };
  }

  const input: SoftPullInput = {
    firstName: person!.firstName,
    lastName: person!.lastName,
    addressLine1: lead.addressLine1!,
    city: lead.city,
    stateCode: lead.stateCode,
    referenceId: lead.publicRef,
  };

  const result = await runSoftCreditPull(input);

  if (!result.ok) {
    const record: CreditPullResult = {
      id: newId("credit"),
      leadId: lead.id,
      pulledAt: nowIso(),
      band: "UNSURE",
      simulated: false,
      failureMessage: result.failure.message,
    };
    db.creditPulls.push(record);
    await pushEvent({
      leadId: lead.id,
      type: "CREDIT_PULL_FAILED",
      actorType: "SYSTEM",
      occurredAt: nowIso(),
      payload: { trigger, reason: result.failure.message, class: result.failure.class },
    });
    saveDb();
    return { ok: false, message: result.failure.message };
  }

  db.creditPulls.push({
    id: newId("credit"),
    leadId: lead.id,
    pulledAt: nowIso(),
    score: result.score,
    band: result.band,
    bureau: result.bureau,
    providerReferenceId: result.providerReferenceId,
    simulated: result.simulated,
  });

  // The verified band replaces whatever the lead was carrying — this is the
  // whole point of the change: a measured score beats a self-reported guess.
  lead.creditRange = result.band;
  lead.updatedAt = nowIso();

  await pushEvent({
    leadId: lead.id,
    type: "CREDIT_PULL_COMPLETED",
    actorType: "SYSTEM",
    occurredAt: nowIso(),
    // The score itself is deliberately NOT in the event payload — events are
    // widely read; the score lives on the credit-pull record alone.
    payload: { trigger, band: result.band, simulated: result.simulated },
  });
  saveDb();

  return {
    ok: true,
    message: result.simulated
      ? "Soft pull simulated — add iSoftpull credentials to run a real inquiry."
      : `Soft pull complete — credit band ${result.band.replace(/_/g, " ").toLowerCase()}.`,
    band: result.band,
    simulated: result.simulated,
  };
}
