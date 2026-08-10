"use server";

import { nanoid } from "nanoid";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { sendSms } from "@/adapters/sms";
import type { AdapterResult } from "@/adapters/result";
import { sendEmail } from "@/adapters/email";
import { extractFieldsFromTranscript, generateOutreachContent, classifySignalIntent, generateSignalReply, validateIntakeIdentity, answerBorrowerQuestion } from "@/adapters/llm";
import { searchForSignals } from "@/adapters/leadDiscovery";
import { getPropertyValuation } from "@/adapters/propertyData";
import { promoteCandidate, type RawCandidate } from "@/core/extraction/promote";
import { resolveCadence } from "@/core/cadence";
import { computeLeadQualityScore } from "@/core/leadScoring";
import { can } from "@/core/rbac";
import { transition } from "@/core/stateMachine";
import { generateToken } from "@/core/auth";
import { intakeInputSchema } from "@/core/intakeValidation";
import { classifyReferral, normalizePhone } from "@/core/intakeNormalization";
import { buildConversationBrief, buildLeadThread } from "@/core/conversationThread";
import { type VoiceMechanism } from "@/core/callStrategy";
import { placeOutboundCall } from "@/domain/voiceOrchestrator";
import { countsAgainstAttemptCap, decideRetry, describeFailure, shouldSuppressChannel, type DeliveryFailure } from "@/core/deliveryStatus";
import { computeOfficerLoadToday } from "@/domain/queries";
import { buildGateInput, evaluateForLead } from "@/domain/gateHelpers";
import { getCurrentUser } from "@/domain/session";
import { getDb, newId, nowIso, saveDb, withLeadLock, type Database } from "@/domain/store";
import { getAppUrl } from "@/lib/runtimeConfig";
import { formatDateTime } from "@/lib/utils";
import type {
  AttemptOutcome,
  CadenceStep,
  Channel,
  ConsentRecord,
  ConversationSession,
  Lead,
  LeadEvent,
  LoanIntent,
  ReferralSpecialty,
  ReferralType,
  Role,
  SuppressionReason,
  SystemConfig,
  Task,
  TaskType,
} from "@/domain/types";
import { STATE_TIMEZONE } from "@/domain/stateTimezone";

async function requireLead(publicRef: string): Promise<Lead> {
  const db = await getDb();
  const lead = Array.from(db.leads.values()).find((l) => l.publicRef === publicRef);
  if (!lead) throw new Error(`Lead not found: ${publicRef}`);
  return lead;
}

export async function pushEvent(partial: Omit<LeadEvent, "id" | "correlationId" | "recordedAt">) {
  const db = await getDb();
  db.events.push({
    id: newId("evt"),
    correlationId: newId("corr"),
    recordedAt: nowIso(),
    ...partial,
  });
}

export async function audit(
  actorId: string,
  actorName: string,
  action: string,
  resourceType: string,
  resourceId: string,
  result: "ALLOW" | "DENY",
  metadata?: Record<string, unknown>
) {
  const db = await getDb();
  db.auditLogs.push({
    id: newId("audit"),
    actorId,
    actorName,
    action,
    resourceType,
    resourceId,
    ipAddress: "127.0.0.1",
    result,
    at: nowIso(),
    metadata,
  });
}

function revalidateLead(publicRef: string) {
  saveDb();
  revalidatePath("/workspace/leads");
  revalidatePath(`/workspace/leads/${publicRef}`);
  revalidatePath("/workspace");
}

export interface ActionResult {
  ok: boolean;
  message: string;
}


// ---------------------------------------------------------------------------
// Send-failure handling — what the CRM does when a live provider rejects a
// message. This is the difference between a demo and an operational system:
// the demo records "sent" and moves on; a real CRM has to decide whether the
// borrower was actually reached, whether to try again, and whether a human
// needs to know.
//
// Three outcomes, driven by core/deliveryStatus.classifyFailure:
//
//   PERMANENT     — the number/address is bad or has opted out. Flag the
//                   contact, suppress this channel for the lead so the cadence
//                   routes around it, and raise a task for a human.
//   CONFIGURATION — our credentials or carrier registration are wrong. Every
//                   lead is about to hit this. Raise an admin-visible alert
//                   once, not one task per lead.
//   TRANSIENT     — retry with backoff; nobody needs to be told yet.
//
// In all three cases the attempt does NOT count against the lead's contact
// caps, because no contact happened.
// ---------------------------------------------------------------------------
async function recordSendFailure(
  db: Database,
  lead: Lead,
  person: { id: string; dataQualityFlags?: string[] } | undefined,
  channel: Channel,
  failure: DeliveryFailure,
  actor?: { id: string; name: string },
  /** True only for callers that incremented the attempt counters *before*
   *  discovering the failure. Callers that increment afterwards must pass
   *  false — otherwise this decrements a previous, genuinely successful
   *  attempt out of the daily count. */
  rollbackCounters = false
): Promise<void> {
  // Attempt caps limit how often a borrower is *contacted*; a message the
  // carrier refused contacted nobody, so an optimistic bump is undone here.
  if (rollbackCounters && !countsAgainstAttemptCap("FAILED")) {
    lead.attemptsTotal = Math.max(0, lead.attemptsTotal - 1);
    lead.attemptsToday = Math.max(0, lead.attemptsToday - 1);
  }

  await pushEvent({
    leadId: lead.id,
    type: "OUTREACH_FAILED",
    actorType: actor ? "OFFICER" : "SYSTEM",
    actorId: actor?.id,
    actorName: actor?.name,
    channel,
    occurredAt: nowIso(),
    payload: { failureClass: failure.class, providerCode: failure.providerCode, message: failure.message },
  });

  if (shouldSuppressChannel(failure)) {
    // A permanently undeliverable address is a fact about the borrower's
    // contact data, not a transient event. Record it so the channel router
    // stops proposing this channel instead of rediscovering it every step.
    if (person) {
      const flag = channel === "EMAIL" ? "EMAIL_UNDELIVERABLE" : "PHONE_UNDELIVERABLE";
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
      title: `${channel === "EMAIL" ? "Email" : "Phone"} undeliverable — verify contact details (${failure.message})`,
    });
  }

  if (failure.affectsAllLeads) {
    // One alert for the whole outage, not one per lead — a misconfigured
    // carrier would otherwise generate a task for every lead in the cadence.
    const alreadyOpen = Array.from(db.tasks.values()).some(
      (t) => t.type === "INTEGRATION_ALERT" && t.status === "OPEN" && t.title.includes(failure.message)
    );
    if (!alreadyOpen) {
      const alertId = newId("task");
      db.tasks.set(alertId, {
        id: alertId,
        leadId: lead.id,
        type: "INTEGRATION_ALERT",
        dueAt: nowIso(),
        status: "OPEN",
        title: `${channel} provider failing — check Admin → Integrations (${failure.message})`,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// F-09 officer actions
// ---------------------------------------------------------------------------
export async function takeOverLeadAction(publicRef: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  const lead = await requireLead(publicRef);

  if (user.role !== "ADMIN" && user.role !== "OFFICER") {
    await audit(user.id, user.name, "TAKE_OVER_LEAD", "Lead", lead.id, "DENY");
    return { ok: false, message: "You don't have permission to take over this lead." };
  }

  let nextState;
  try {
    nextState = transition(lead.state, "OFFICER_TAKEOVER");
  } catch {
    return { ok: false, message: `Cannot take over a lead in a terminal state (${lead.state}).` };
  }
  lead.assignedOfficerId = user.officerId ?? lead.assignedOfficerId;
  lead.state = nextState;
  lead.updatedAt = nowIso();

  await pushEvent({
    leadId: lead.id,
    type: "OFFICER_TAKEOVER",
    actorType: "OFFICER",
    actorId: user.id,
    actorName: user.name,
    occurredAt: nowIso(),
  });
  await audit(user.id, user.name, "TAKE_OVER_LEAD", "Lead", lead.id, "ALLOW");
  revalidateLead(publicRef);
  return { ok: true, message: `You've taken over this lead. Automation is paused.` };
}

// Manual handoff — distinct from takeOverLeadAction (self-assign) and
// autoAssignOfficer (system-driven): lets Admin route a lead to a specific
// officer for load balancing, vacation coverage, or specialty routing.
export async function assignOfficerAction(publicRef: string, officerId: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (user.role !== "ADMIN") {
    return { ok: false, message: "Only Admin can manually assign a lead to an officer." };
  }
  const lead = await requireLead(publicRef);
  const db = await getDb();
  const officer = db.officers.get(officerId);
  if (!officer || !officer.isActive) return { ok: false, message: "That officer is not available." };

  const previousOfficerId = lead.assignedOfficerId;
  lead.assignedOfficerId = officerId;
  lead.updatedAt = nowIso();

  await pushEvent({
    leadId: lead.id,
    type: "OFFICER_ASSIGNED",
    actorType: "ADMIN",
    actorId: user.id,
    actorName: user.name,
    occurredAt: nowIso(),
    payload: { officerId, reason: "manual_assignment", previousOfficerId },
  });
  await audit(user.id, user.name, "ASSIGN_OFFICER", "Lead", lead.id, "ALLOW", { officerId, previousOfficerId });
  saveDb();
  revalidateLead(publicRef);
  return { ok: true, message: `Assigned to ${officer.name}.` };
}

export async function acknowledgeAssignmentAction(publicRef: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  const lead = await requireLead(publicRef);

  if (lead.state !== "ASSIGNED") {
    return { ok: false, message: `Lead must be in ASSIGNED state to acknowledge (currently ${lead.state}).` };
  }
  lead.state = transition(lead.state, "OFFICER_ACKNOWLEDGED");
  lead.updatedAt = nowIso();

  const db = await getDb();
  for (const t of db.tasks.values()) {
    if (t.leadId === lead.id && t.type === "ACKNOWLEDGE_HANDOFF" && t.status === "OPEN") {
      t.status = "COMPLETED";
      t.completedAt = nowIso();
      t.completedById = user.id;
    }
  }

  await pushEvent({
    leadId: lead.id,
    type: "OFFICER_ACKNOWLEDGED",
    actorType: "OFFICER",
    actorId: user.id,
    actorName: user.name,
    occurredAt: nowIso(),
  });
  await audit(user.id, user.name, "ACKNOWLEDGE_HANDOFF", "Lead", lead.id, "ALLOW");
  revalidateLead(publicRef);
  return { ok: true, message: "Handoff acknowledged. Automation halted permanently for this lead." };
}

// ---------------------------------------------------------------------------
// Call log editing — manual entries for contact that happened off-platform,
// and corrections to outcomes already on file.
// ---------------------------------------------------------------------------
export async function logManualCallAction(
  publicRef: string,
  channel: Channel,
  outcome: AttemptOutcome,
  notes: string
): Promise<ActionResult> {
  const user = await getCurrentUser();
  const lead = await requireLead(publicRef);

  if (!can({ role: user.role, officerId: user.officerId }, "CALL_NOW", lead)) {
    return { ok: false, message: "You don't have permission to log contact on this lead." };
  }

  const db = await getDb();
  const attemptId = newId("attempt");
  db.attempts.push({
    id: attemptId,
    leadId: lead.id,
    channel,
    direction: "OUTBOUND",
    idempotencyKey: newId("idem"),
    outcome,
    attemptNumber: lead.attemptsTotal + 1,
    scheduledFor: nowIso(),
    startedAt: nowIso(),
    endedAt: nowIso(),
  });

  lead.attemptsTotal += 1;
  lead.attemptsToday += 1;
  lead.lastAttemptAt = nowIso();
  if (!lead.firstContactAt) lead.firstContactAt = nowIso();
  lead.lastContactAt = nowIso();
  if (lead.state === "NEW") {
    try {
      lead.state = transition(lead.state, "OUTREACH_ATTEMPTED");
    } catch {
      // leave state as-is if the transition isn't valid from here
    }
  }
  lead.updatedAt = nowIso();

  await pushEvent({
    leadId: lead.id,
    type: "OUTREACH_ATTEMPTED",
    actorType: "OFFICER",
    actorId: user.id,
    actorName: user.name,
    channel,
    occurredAt: nowIso(),
    payload: { manual: true, loggedAfterTheFact: true, outcome, notes: notes.trim() || undefined },
  });
  if (notes.trim()) {
    db.notes.push({ id: newId("note"), leadId: lead.id, authorId: user.id, authorName: user.name, body: `Call log: ${notes.trim()}`, createdAt: nowIso() });
  }
  await audit(user.id, user.name, "LOG_MANUAL_CALL", "ContactAttempt", attemptId, "ALLOW");
  revalidateLead(publicRef);
  return { ok: true, message: "Call logged." };
}

export async function editAttemptOutcomeAction(
  publicRef: string,
  attemptId: string,
  outcome: AttemptOutcome,
  notes: string
): Promise<ActionResult> {
  const user = await getCurrentUser();
  const lead = await requireLead(publicRef);

  if (!can({ role: user.role, officerId: user.officerId }, "EDIT_FIELDS", lead)) {
    return { ok: false, message: "You don't have permission to edit call logs on this lead." };
  }

  const db = await getDb();
  const attempt = db.attempts.find((a) => a.id === attemptId && a.leadId === lead.id);
  if (!attempt) return { ok: false, message: "Call log entry not found." };

  const previousOutcome = attempt.outcome;
  attempt.outcome = outcome;

  await pushEvent({
    leadId: lead.id,
    type: "FIELD_CORRECTED",
    actorType: "OFFICER",
    actorId: user.id,
    actorName: user.name,
    channel: attempt.channel,
    occurredAt: nowIso(),
    payload: { correctedAttemptId: attemptId, previousOutcome, newOutcome: outcome, notes: notes.trim() || undefined },
  });
  await audit(user.id, user.name, "EDIT_CALL_LOG", "ContactAttempt", attemptId, "ALLOW");
  revalidateLead(publicRef);
  return { ok: true, message: "Call log updated." };
}

export async function addNoteAction(publicRef: string, body: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  const lead = await requireLead(publicRef);
  if (!body.trim()) return { ok: false, message: "Note cannot be empty." };

  const db = await getDb();
  db.notes.push({
    id: newId("note"),
    leadId: lead.id,
    authorId: user.id,
    authorName: user.name,
    body: body.trim(),
    createdAt: nowIso(),
  });
  await pushEvent({
    leadId: lead.id,
    type: "NOTE_ADDED",
    actorType: user.role === "OFFICER" ? "OFFICER" : "ADMIN",
    actorId: user.id,
    actorName: user.name,
    occurredAt: nowIso(),
  });
  revalidateLead(publicRef);
  return { ok: true, message: "Note added." };
}

export async function confirmFieldAction(publicRef: string, fieldPath: string, value: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  const lead = await requireLead(publicRef);

  if (!can({ role: user.role, officerId: user.officerId }, "EDIT_FIELDS", lead)) {
    return { ok: false, message: "You don't have permission to edit fields on this lead." };
  }

  const db = await getDb();
  const key = `${lead.id}:${fieldPath}`;
  const existing = db.leadFields.get(key);
  db.leadFields.set(key, {
    id: existing?.id ?? newId("field"),
    leadId: lead.id,
    fieldPath,
    value,
    status: "CONFIRMED",
    confidence: 1,
    sourceType: "OFFICER_ENTERED",
    collectedAt: nowIso(),
    lastUpdatedById: user.id,
    verificationStatus: "VERIFIED",
    supersededCandidateIds: existing ? [...existing.supersededCandidateIds, existing.id] : [],
  });

  await pushEvent({
    leadId: lead.id,
    type: "FIELD_CORRECTED",
    actorType: "OFFICER",
    actorId: user.id,
    actorName: user.name,
    occurredAt: nowIso(),
    payload: { fieldPath, value },
  });
  await audit(user.id, user.name, "EDIT_FIELD", "LeadField", key, "ALLOW");
  revalidateLead(publicRef);
  return { ok: true, message: "Field confirmed and locked in as officer-entered." };
}

export async function markWonLostAction(publicRef: string, outcome: "WON" | "LOST", reason?: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  const lead = await requireLead(publicRef);

  if (!can({ role: user.role, officerId: user.officerId }, "MARK_WON_LOST", lead)) {
    return { ok: false, message: "You don't have permission to close this lead." };
  }
  if (lead.state !== "ACKNOWLEDGED") {
    return { ok: false, message: `Lead must be ACKNOWLEDGED before it can be closed (currently ${lead.state}).` };
  }

  lead.state = transition(lead.state, outcome === "WON" ? "MARKED_WON" : "MARKED_LOST");
  lead.updatedAt = nowIso();

  await pushEvent({
    leadId: lead.id,
    type: outcome === "WON" ? "MARKED_WON" : "MARKED_LOST",
    actorType: "OFFICER",
    actorId: user.id,
    actorName: user.name,
    occurredAt: nowIso(),
    payload: reason ? { reason } : undefined,
  });
  await audit(user.id, user.name, `MARK_${outcome}`, "Lead", lead.id, "ALLOW");
  revalidateLead(publicRef);
  return { ok: true, message: outcome === "WON" ? "Marked as won. Congrats!" : "Marked as lost." };
}

// ---------------------------------------------------------------------------
// F-06 structured extraction (real Anthropic call when ANTHROPIC_API_KEY is
// set; deterministic keyword-scan fallback otherwise — same pipeline either way).
// ---------------------------------------------------------------------------
/** Shared by the manual "Run AI extraction" button and the Vapi webhook
 *  (adapters/voiceAgent.ts's end-of-call-report handler) — a live call's
 *  transcript flows through the exact same extraction/promotion pipeline a
 *  seeded/simulated one always has. */
export async function runExtractionForConversation(
  db: Database,
  lead: Lead,
  conversation: ConversationSession,
  actor: { actorType: "OFFICER" | "SYSTEM"; actorId?: string }
): Promise<{ fieldCount: number; promotedCount: number; simulated: boolean }> {
  const { fields, simulated } = await extractFieldsFromTranscript(conversation.transcript);

  let promotedCount = 0;
  for (const field of fields) {
    const candidate: RawCandidate = {
      fieldPath: field.fieldPath,
      value: field.value,
      confidence: field.confidence,
      transcriptTurnRefs: field.transcriptTurnRefs,
      sourceType: "BORROWER_STATED",
    };

    const key = `${lead.id}:${field.fieldPath}`;
    const existing = db.leadFields.get(key);
    const result = promoteCandidate(candidate, existing);
    if (result.promoted) promotedCount += 1;

    db.fieldCandidates.push({
      id: newId("cand"),
      leadId: lead.id,
      fieldPath: field.fieldPath,
      value: field.value,
      confidence: field.confidence,
      sourceType: "BORROWER_STATED",
      sessionId: conversation.id,
      transcriptTurnRefs: field.transcriptTurnRefs,
      createdAt: nowIso(),
      promoted: result.promoted,
      promotionRuleCode: result.ruleCode,
    });

    db.leadFields.set(key, {
      id: existing?.id ?? newId("field"),
      leadId: lead.id,
      fieldPath: field.fieldPath,
      value: result.value,
      status: result.status,
      confidence: field.confidence,
      sourceType: existing?.sourceType === "OFFICER_ENTERED" ? existing.sourceType : "BORROWER_STATED",
      collectedAt: nowIso(),
      verificationStatus: existing?.verificationStatus ?? "UNVERIFIED",
      supersededCandidateIds: existing?.supersededCandidateIds ?? [],
      conflictingValue: result.conflictingValue,
    });
  }

  await pushEvent({
    leadId: lead.id,
    type: "FIELDS_EXTRACTED",
    actorType: actor.actorType,
    occurredAt: nowIso(),
    payload: { fieldCount: fields.length, promotedCount, simulated, actorId: actor.actorId },
  });

  return { fieldCount: fields.length, promotedCount, simulated };
}

export async function runExtractionAction(publicRef: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  const lead = await requireLead(publicRef);
  const db = await getDb();

  const conversation = Array.from(db.conversations.values())
    .filter((c) => c.leadId === lead.id)
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())[0];

  if (!conversation || conversation.transcript.length === 0) {
    return { ok: false, message: "No transcript to extract from yet." };
  }

  const { fieldCount, promotedCount, simulated } = await runExtractionForConversation(db, lead, conversation, {
    actorType: "OFFICER",
    actorId: user.id,
  });
  saveDb();
  revalidateLead(publicRef);

  return {
    ok: true,
    message: simulated
      ? `Extracted ${fieldCount} fields (simulated keyword scan — set ANTHROPIC_API_KEY for live extraction).`
      : `Extracted ${fieldCount} fields via Claude, ${promotedCount} auto-confirmed.`,
  };
}

export async function requestComplianceReviewAction(publicRef: string, note: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  const lead = await requireLead(publicRef);
  const db = await getDb();

  const task: Task = {
    id: newId("task"),
    leadId: lead.id,
    type: "COMPLAINT",
    dueAt: nowIso(),
    status: "OPEN",
    title: "Compliance review requested",
  };
  db.tasks.set(task.id, task);
  if (note.trim()) {
    db.notes.push({ id: newId("note"), leadId: lead.id, authorId: user.id, authorName: user.name, body: note.trim(), createdAt: nowIso() });
  }
  await pushEvent({ leadId: lead.id, type: "ESCALATED", actorType: "OFFICER", actorId: user.id, actorName: user.name, occurredAt: nowIso(), payload: { reason: "MANUAL_COMPLIANCE_REQUEST" } });
  revalidateLead(publicRef);
  return { ok: true, message: "Compliance review requested." };
}

// ---------------------------------------------------------------------------
// F-02 suppression + F-12 kill switch (admin/compliance)
// ---------------------------------------------------------------------------
export async function addSuppressionAction(phoneE164: string, reason: SuppressionReason): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!can({ role: user.role, officerId: user.officerId }, "MANAGE_SUPPRESSION")) {
    return { ok: false, message: "Only Admin or Compliance can manage suppressions." };
  }
  const db = await getDb();
  db.suppressions.set(phoneE164, {
    id: newId("supp"),
    phoneE164,
    reason,
    scope: "GLOBAL",
    createdAt: nowIso(),
    expiresAt: null,
  });

  for (const lead of db.leads.values()) {
    const person = Array.from(db.people.values()).find((p) => p.leadId === lead.id && p.role === "PRIMARY");
    if (person?.phoneE164 === phoneE164 && !["SUPPRESSED", "CLOSED_WON", "CLOSED_LOST"].includes(lead.state)) {
      lead.state = "SUPPRESSED";
      lead.updatedAt = nowIso();
      await pushEvent({ leadId: lead.id, type: "OPT_OUT_RECEIVED", actorType: "ADMIN", actorId: user.id, actorName: user.name, occurredAt: nowIso(), payload: { reason: "MANUAL" } });
    }
  }
  await audit(user.id, user.name, "ADD_SUPPRESSION", "Suppression", phoneE164, "ALLOW");
  saveDb();
  revalidatePath("/workspace/suppression");
  revalidatePath("/workspace/leads");
  return { ok: true, message: `${phoneE164} suppressed globally.` };
}

export async function liftSuppressionAction(phoneE164: string, reason: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (user.role !== "ADMIN") {
    return { ok: false, message: "Only Admin can lift a suppression, with a written reason." };
  }
  if (!reason.trim()) return { ok: false, message: "A written reason is required to lift a suppression." };

  const db = await getDb();
  const supp = db.suppressions.get(phoneE164);
  if (!supp) return { ok: false, message: "No suppression found for that number." };
  const liftedScope = supp.scope;
  db.suppressions.delete(phoneE164);

  // The mandated written reason has to survive past this point — the
  // Suppression record itself is deleted right above (that's the point of
  // lifting it), so the audit log's metadata is the only place it can live.
  await audit(user.id, user.name, "SUPPRESSION_LIFTED", "Suppression", phoneE164, "ALLOW", { reason: reason.trim(), scope: liftedScope });
  saveDb();
  revalidatePath("/workspace/suppression");
  return { ok: true, message: `Suppression lifted for ${phoneE164}.` };
}

// Public, unauthenticated self-serve opt-out (the "/unsubscribe" page and the
// SMS STOP-reply path both land here eventually). Deliberately doesn't
// require identity verification beyond the phone number itself — TCPA
// expects opt-out to be frictionless, and the worst case of someone
// suppressing a number they don't own is that number stops being contacted,
// which is the safe direction to err in. Always returns success so this
// can't be used to enumerate which phone numbers are known leads.
export async function selfServeOptOutAction(phone: string): Promise<ActionResult> {
  const normalized = normalizePhone(phone);
  if (!normalized) return { ok: false, message: "Enter a valid 10-digit US phone number." };

  const db = await getDb();
  if (!db.suppressions.has(normalized)) {
    db.suppressions.set(normalized, {
      id: newId("supp"),
      phoneE164: normalized,
      reason: "OPT_OUT_STOP",
      scope: "GLOBAL",
      createdAt: nowIso(),
      expiresAt: null,
    });

    for (const lead of db.leads.values()) {
      const person = Array.from(db.people.values()).find((p) => p.leadId === lead.id && p.role === "PRIMARY");
      if (person?.phoneE164 === normalized && !["SUPPRESSED", "CLOSED_WON", "CLOSED_LOST"].includes(lead.state)) {
        lead.state = "SUPPRESSED";
        lead.updatedAt = nowIso();
        await pushEvent({
          leadId: lead.id,
          type: "OPT_OUT_RECEIVED",
          actorType: "BORROWER",
          occurredAt: nowIso(),
          payload: { reason: "OPT_OUT_STOP", source: "self_serve_unsubscribe" },
        });
      }
    }
    await audit("borrower", "Borrower (self-serve opt-out)", "ADD_SUPPRESSION", "Suppression", normalized, "ALLOW", {
      source: "self_serve_unsubscribe",
    });
    saveDb();
    revalidatePath("/workspace/suppression");
    revalidatePath("/workspace/leads");
  }

  return { ok: true, message: "You're opted out — we won't call, text, or email that number again." };
}

export async function toggleKillSwitchAction(reason: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!can({ role: user.role, officerId: user.officerId }, "TOGGLE_KILL_SWITCH")) {
    return { ok: false, message: "Only Admin or Compliance can toggle the kill switch." };
  }
  if (!reason.trim()) return { ok: false, message: "A reason is required to toggle the kill switch." };

  const db = await getDb();
  db.killSwitch = {
    isOn: !db.killSwitch.isOn,
    toggledAt: nowIso(),
    toggledById: user.id,
    reason: reason.trim(),
  };
  await audit(user.id, user.name, "KILL_SWITCH_TOGGLED", "System", "kill_switch", "ALLOW");
  saveDb();
  revalidatePath("/workspace/admin");
  revalidatePath("/workspace");
  return { ok: true, message: db.killSwitch.isOn ? "Kill switch activated. All outbound automation is paused." : "Kill switch deactivated. Automation resumed." };
}

// ---------------------------------------------------------------------------
// Lead discovery — public forum posts, classified for intent, reviewed by a
// human. Promotion creates a CRM lead with zero consent records so
// PolicyGate's existing NO_CONSENT rule blocks every automated attempt on it,
// permanently — the same gate that protects every other lead protects these
// by construction, not by a special case.
// ---------------------------------------------------------------------------
export async function runLeadDiscoveryAction(query?: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!can({ role: user.role, officerId: user.officerId }, "MANAGE_SUPPRESSION")) {
    return { ok: false, message: "Only Admin or Compliance can run lead discovery." };
  }

  const db = await getDb();
  const { signals: raw, simulated } = await searchForSignals(query);

  let added = 0;
  for (const r of raw) {
    const alreadyExists = Array.from(db.signals.values()).some((s) => s.sourceUrl === r.sourceUrl);
    if (alreadyExists) continue;

    const classification = await classifySignalIntent(`${r.title}\n\n${r.snippet}`);
    const id = newId("signal");
    db.signals.set(id, {
      id,
      source: r.source,
      sourceUrl: r.sourceUrl,
      subreddit: r.subreddit,
      authorHandle: r.authorHandle,
      title: r.title,
      snippet: r.snippet,
      postedAt: r.postedAt,
      detectedIntent: classification.intent,
      confidence: classification.confidence,
      matchedKeywords: classification.matchedKeywords,
      status: "NEW",
      discoveredAt: nowIso(),
    });
    added += 1;
  }

  await audit(user.id, user.name, "RUN_LEAD_DISCOVERY", "DiscoveredSignal", "*", "ALLOW");
  saveDb();
  revalidatePath("/workspace/discovery");
  return {
    ok: true,
    message: `Found ${added} new signal${added === 1 ? "" : "s"}${simulated ? " (simulated — set REDDIT_CLIENT_ID/REDDIT_CLIENT_SECRET for live search)" : ""}.`,
  };
}

export async function generateSignalReplyAction(signalId: string): Promise<{ body: string; simulated: boolean }> {
  const db = await getDb();
  const signal = db.signals.get(signalId);
  if (!signal) return { body: "", simulated: true };
  return generateSignalReply({ title: signal.title, snippet: signal.snippet, subreddit: signal.subreddit ?? "personalfinance" });
}

export async function dismissSignalAction(signalId: string, note: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!can({ role: user.role, officerId: user.officerId }, "MANAGE_SUPPRESSION")) {
    return { ok: false, message: "Only Admin or Compliance can review discovered signals." };
  }
  const db = await getDb();
  const signal = db.signals.get(signalId);
  if (!signal) return { ok: false, message: "Signal not found." };

  signal.status = "DISMISSED";
  signal.reviewedById = user.id;
  signal.reviewedByName = user.name;
  signal.reviewNote = note.trim() || undefined;
  signal.reviewedAt = nowIso();

  await audit(user.id, user.name, "DISMISS_SIGNAL", "DiscoveredSignal", signalId, "ALLOW");
  saveDb();
  revalidatePath("/workspace/discovery");
  return { ok: true, message: "Signal dismissed." };
}

export async function promoteSignalToLeadAction(signalId: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (user.role !== "ADMIN") {
    return { ok: false, message: "Only Admin can add a discovered signal to the CRM." };
  }
  const db = await getDb();
  const signal = db.signals.get(signalId);
  if (!signal) return { ok: false, message: "Signal not found." };
  if (signal.promotedLeadId) return { ok: false, message: "Already added to the CRM." };

  const leadId = newId("lead");
  const personId = newId("person");
  const publicRef = nanoid(10);
  const createdAt = nowIso();

  db.people.set(personId, {
    id: personId,
    leadId,
    role: "PRIMARY",
    firstName: signal.authorHandle,
    lastName: "(forum contact)",
    phoneE164: "UNKNOWN",
    email: "unknown@forum-signal.local",
    preferredContactWindow: "ANY",
    timezone: "UNKNOWN",
  });

  // Deliberately zero ConsentRecord rows — PolicyGate's NO_CONSENT rule then
  // denies every channel for this lead, automated or manual, until a real
  // consented intake happens. No other code path needs to know this lead
  // came from a forum post; the gate handles it uniformly.
  const lead: Lead = {
    id: leadId,
    publicRef,
    state: "NURTURE",
    intent: signal.detectedIntent,
    goal: "OTHER",
    timeline: "EXPLORING",
    creditRange: "UNSURE",
    sourceId: "forum_discovery",
    stateCode: "UNKNOWN",
    occupancy: "UNKNOWN",
    cadencePlanVersionId: "cadence_default",
    slaDueAt: createdAt,
    completenessScore: 0,
    createdAt,
    updatedAt: createdAt,
    attemptsToday: 0,
    attemptsTotal: 0,
    lastAttemptAt: null,
  };
  db.leads.set(leadId, lead);

  const taskId = newId("task");
  db.tasks.set(taskId, {
    id: taskId,
    leadId,
    type: "REVIEW_MISSING_FIELDS",
    dueAt: createdAt,
    status: "OPEN",
    title: "No consent on file — sourced from a public post, verify before any contact",
  });

  await pushEvent({
    leadId,
    type: "LEAD_CREATED",
    actorType: "ADMIN",
    actorId: user.id,
    actorName: user.name,
    occurredAt: createdAt,
    payload: { source: "forum_discovery", sourceUrl: signal.sourceUrl, detectedIntent: signal.detectedIntent },
  });

  signal.status = "ACTIONED";
  signal.promotedLeadId = leadId;
  signal.reviewedById = user.id;
  signal.reviewedByName = user.name;
  signal.reviewedAt = createdAt;

  await audit(user.id, user.name, "PROMOTE_SIGNAL_TO_LEAD", "Lead", leadId, "ALLOW");
  saveDb();
  revalidatePath("/workspace/discovery");
  revalidatePath("/workspace/leads");
  return { ok: true, message: "Added to the CRM with no consent on file — automated contact is blocked by PolicyGate until that changes." };
}

// ---------------------------------------------------------------------------
// F-12 admin: system config (SLA, attempt caps, quiet hours)
// ---------------------------------------------------------------------------
export async function updateSystemConfigAction(config: SystemConfig): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!can({ role: user.role, officerId: user.officerId }, "EDIT_CADENCE_PROMPTS_DISCLOSURES")) {
    return { ok: false, message: "Only Admin can change system configuration." };
  }
  if (config.firstContactSlaMinutes < 1 || config.dailyAttemptCap < 1 || config.minSpacingHours < 0) {
    return { ok: false, message: "Values must be positive." };
  }
  if (config.quietHoursStart < 0 || config.quietHoursStart > 23 || config.quietHoursEnd < 1 || config.quietHoursEnd > 24 || config.quietHoursStart >= config.quietHoursEnd) {
    return { ok: false, message: "Quiet hours must be a valid 0-24 range with start before end." };
  }
  if (!config.senderName.trim() || !config.senderEmail.includes("@")) {
    return { ok: false, message: "Enter a sender name and a valid sender email." };
  }
  const weights = config.scoringWeights;
  if (weights.equity < 0 || weights.margin < 0 || weights.compliance < 0 || weights.behavior < 0) {
    return { ok: false, message: "Scoring weights can't be negative." };
  }
  if (config.hotLeadThreshold < 1 || config.hotLeadThreshold > 100) {
    return { ok: false, message: "Hot-lead threshold must be between 1 and 100." };
  }

  const db = await getDb();
  const previousOverrides = db.config.outreachOverrides ?? {};
  db.config = { ...config };

  // Turning a pacing rule off is a compliance-relevant decision. Audit it
  // separately from the rest of the settings save, naming which guardrail
  // changed and who changed it — "we didn't know it was on" must never be an
  // available answer.
  const nextOverrides = config.outreachOverrides ?? {};
  const overrideKeys = ["ignoreQuietHours", "ignoreAttemptCaps", "ignoreMinSpacing"] as const;
  const changedOverrides = overrideKeys.filter((k) => Boolean(previousOverrides[k]) !== Boolean(nextOverrides[k]));
  if (changedOverrides.length > 0) {
    await audit(user.id, user.name, "CHANGE_OUTREACH_OVERRIDES", "System", "config", "ALLOW", {
      changed: changedOverrides.map((k) => `${k}=${Boolean(nextOverrides[k])}`),
    });
  }

  await audit(user.id, user.name, "UPDATE_SYSTEM_CONFIG", "System", "config", "ALLOW");
  saveDb();
  revalidatePath("/workspace/admin");
  return { ok: true, message: "Settings saved. Every new PolicyGate check uses these values immediately." };
}

// ---------------------------------------------------------------------------
// Cadence plans — editable per-state/intent contact schedules.
// ---------------------------------------------------------------------------
export async function updateCadencePlanAction(planId: string, steps: CadenceStep[]): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!can({ role: user.role, officerId: user.officerId }, "EDIT_CADENCE_PROMPTS_DISCLOSURES")) {
    return { ok: false, message: "Only Admin can edit cadence plans." };
  }
  if (steps.length === 0) return { ok: false, message: "A cadence plan needs at least one step." };
  for (const s of steps) {
    if (s.offsetMinutes < 0 || s.maxAttempts < 1) return { ok: false, message: "Offsets must be 0+ and max attempts must be at least 1." };
  }

  const db = await getDb();
  const plan = db.cadencePlans.get(planId);
  if (!plan) return { ok: false, message: "Cadence plan not found." };

  plan.steps = steps.map((s) => ({ ...s, stopOnOutcomes: s.stopOnOutcomes ?? [] })).sort((a, b) => a.offsetMinutes - b.offsetMinutes);
  await audit(user.id, user.name, "EDIT_CADENCE_PLAN", "CadencePlan", planId, "ALLOW");
  saveDb();
  revalidatePath("/workspace/admin");
  return { ok: true, message: "Cadence plan saved. In-flight leads keep their snapshotted version — this only affects new attempts." };
}

export async function createCadencePlanAction(input: { name: string; stateCode?: string; intent?: LoanIntent }): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!can({ role: user.role, officerId: user.officerId }, "EDIT_CADENCE_PROMPTS_DISCLOSURES")) {
    return { ok: false, message: "Only Admin can create cadence plans." };
  }
  if (!input.name.trim()) return { ok: false, message: "Name is required." };

  const db = await getDb();
  const id = newId("cadence");
  db.cadencePlans.set(id, {
    id,
    name: input.name.trim(),
    stateCode: input.stateCode || undefined,
    intent: input.intent || undefined,
    isDefault: false,
    steps: [{ offsetMinutes: 0, channel: "VOICE", maxAttempts: 3, stopOnOutcomes: ["ANSWERED"] }],
  });
  await audit(user.id, user.name, "CREATE_CADENCE_PLAN", "CadencePlan", id, "ALLOW");
  saveDb();
  revalidatePath("/workspace/admin");
  return { ok: true, message: `${input.name} created — add steps and save.` };
}

// ---------------------------------------------------------------------------
// Disclosure versioning — previously write-once at seed time with no admin
// path to ever change the wording. A DRAFT never affects live consent
// capture; only approving one does, at which point the prior APPROVED
// version for that key is retired (not deleted — it stays as the exact
// record of what borrowers actually agreed to before the change).
// ---------------------------------------------------------------------------
export async function createDisclosureDraftAction(key: string, bodyText: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!can({ role: user.role, officerId: user.officerId }, "EDIT_CADENCE_PROMPTS_DISCLOSURES")) {
    return { ok: false, message: "Only Admin can draft a new disclosure version." };
  }
  if (!key.trim() || !bodyText.trim()) return { ok: false, message: "Key and body text are required." };

  const db = await getDb();
  const existingVersions = Array.from(db.disclosures.values()).filter((d) => d.key === key.trim());
  const nextVersion = existingVersions.length > 0 ? Math.max(...existingVersions.map((d) => d.version)) + 1 : 1;

  const id = newId("disclosure");
  db.disclosures.set(id, {
    id,
    key: key.trim(),
    version: nextVersion,
    bodyText: bodyText.trim(),
    effectiveFrom: nowIso(),
    approvedBy: "",
    approvedAt: "",
    status: "DRAFT",
  });
  await audit(user.id, user.name, "CREATE_DISCLOSURE_DRAFT", "DisclosureVersion", id, "ALLOW");
  saveDb();
  revalidatePath("/workspace/admin");
  return { ok: true, message: `Draft v${nextVersion} created for "${key.trim()}" — approve it to make it live.` };
}

export async function approveDisclosureAction(disclosureId: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!can({ role: user.role, officerId: user.officerId }, "APPROVE_CADENCE_PROMPTS_DISCLOSURES")) {
    return { ok: false, message: "Only Admin or Compliance can approve a disclosure version." };
  }
  const db = await getDb();
  const draft = db.disclosures.get(disclosureId);
  if (!draft) return { ok: false, message: "Disclosure version not found." };
  if (draft.status !== "DRAFT") return { ok: false, message: "Only a draft can be approved." };

  const now = nowIso();
  for (const d of db.disclosures.values()) {
    if (d.key === draft.key && d.status === "APPROVED") {
      d.status = "RETIRED";
      d.effectiveTo = now;
    }
  }
  draft.status = "APPROVED";
  draft.approvedBy = user.name;
  draft.approvedAt = now;
  draft.effectiveFrom = now;

  await audit(user.id, user.name, "APPROVE_DISCLOSURE", "DisclosureVersion", disclosureId, "ALLOW");
  saveDb();
  revalidatePath("/workspace/admin");
  return { ok: true, message: `"${draft.key}" v${draft.version} is now live.` };
}

// ---------------------------------------------------------------------------
// F-10 admin: user profiles (create officer/compliance/admin/read-only accounts)
// ---------------------------------------------------------------------------
export interface CreateUserInput {
  name: string;
  email: string;
  phone?: string;
  role: Role;
  nmlsId?: string;
  licensedStates?: string[];
  productTypes?: LoanIntent[];
  dailyCapacity?: number;
}

export async function createUserAction(input: CreateUserInput): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (user.role !== "ADMIN") {
    return { ok: false, message: "Only Admin can create user profiles." };
  }
  if (!input.name.trim() || !input.email.trim() || !input.email.includes("@")) {
    return { ok: false, message: "A name and valid email are required." };
  }
  const db = await getDb();
  const emailTaken = Array.from(db.users.values()).some((u) => u.email.toLowerCase() === input.email.trim().toLowerCase());
  if (emailTaken) {
    return { ok: false, message: "A user with that email already exists." };
  }

  const userId = newId("user");
  let officerId: string | undefined;

  if (input.role === "OFFICER") {
    officerId = newId("off");
    db.officers.set(officerId, {
      id: officerId,
      userId,
      name: input.name.trim(),
      email: input.email.trim(),
      phone: input.phone ? (normalizePhone(input.phone) ?? undefined) : undefined,
      nmlsId: input.nmlsId?.trim() || "PENDING",
      licensedStates: input.licensedStates ?? [],
      productTypes: input.productTypes && input.productTypes.length > 0 ? input.productTypes : ["REFINANCE", "HOME_EQUITY", "CASH_OUT"],
      dailyCapacity: input.dailyCapacity ?? 10,
      currentLoad: 0,
      activeHoursStart: 8,
      activeHoursEnd: 18,
      isActive: true,
    });
  }

  db.users.set(userId, {
    id: userId,
    name: input.name.trim(),
    email: input.email.trim(),
    role: input.role,
    officerId,
    isActive: true,
    createdAt: nowIso(),
    createdById: user.id,
  });

  const inviteToken = generateToken();
  db.authTokens.set(inviteToken, {
    token: inviteToken,
    userId,
    purpose: "invite",
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  });

  await audit(user.id, user.name, "CREATE_USER", "User", userId, "ALLOW");
  saveDb();
  revalidatePath("/workspace/admin");

  const roleLabel = input.role.replace("_", " ").toLowerCase();
  const idempotencyKey = newId("idem");
  const inviteUrl = `${await getAppUrl()}/accept-invite?token=${inviteToken}`;
  const emailResult = await sendEmail({
    to: input.email.trim(),
    subject: "You've been added to Equity Flow Group",
    text: `Hi ${input.name.split(" ")[0]},\n\n${user.name} added you to Equity Flow Group as ${roleLabel}. Set your password to get started:\n${inviteUrl}\n\nThis link expires in 7 days.\n\n— Equity Flow Group`,
    idempotencyKey,
    from: `${db.config.senderName} <${db.config.senderEmail}>`,
  });
  let smsResult: AdapterResult | null = null;
  const phone = input.phone ? normalizePhone(input.phone) : null;
  if (phone) {
    smsResult = await sendSms({ to: phone, body: `Hi ${input.name.split(" ")[0]}, you've been added to Equity Flow Group as ${roleLabel}. Check your email to sign in.`, idempotencyKey: newId("idem") });
  }

  // The account exists either way, but if the invite email didn't go out the
  // new user has no way to set a password — saying "they can now sign in"
  // would send the admin away believing a broken onboarding was complete.
  if (!emailResult.ok) {
    return {
      ok: false,
      message: `${input.name}'s account was created, but the invite email failed to send (${emailResult.failure.message}). Use "Resend invite" once email is working.`,
    };
  }

  const notified = [
    emailResult.simulated ? "email (simulated)" : "email",
    phone ? (smsResult?.ok ? (smsResult.simulated ? "text (simulated)" : "text") : "text FAILED") : null,
  ].filter(Boolean).join(" and ");
  return { ok: true, message: `${input.name} can now sign in as ${roleLabel}. Welcome ${notified} sent.` };
}

export async function setUserActiveAction(userId: string, isActive: boolean): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (user.role !== "ADMIN") {
    return { ok: false, message: "Only Admin can change portal access." };
  }
  if (userId === user.id) {
    return { ok: false, message: "You can't revoke your own access." };
  }
  const db = await getDb();
  const target = db.users.get(userId);
  if (!target) return { ok: false, message: "User not found." };

  target.isActive = isActive;
  if (target.officerId) {
    const officer = db.officers.get(target.officerId);
    if (officer) officer.isActive = isActive;
  }

  await audit(user.id, user.name, isActive ? "REACTIVATE_USER" : "DEACTIVATE_USER", "User", userId, "ALLOW");
  saveDb();
  revalidatePath("/workspace/admin");
  return { ok: true, message: isActive ? `${target.name}'s access restored.` : `${target.name}'s portal access revoked.` };
}

// A user who never completed /accept-invite has no passwordHash and can't
// log in at all — the original invite link may have expired (7 days) or
// been lost. Issues a fresh token rather than trying to resurrect the old
// one, and re-sends the same welcome email.
export async function resendInviteAction(userId: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (user.role !== "ADMIN") {
    return { ok: false, message: "Only Admin can resend an invite." };
  }
  const db = await getDb();
  const target = db.users.get(userId);
  if (!target) return { ok: false, message: "User not found." };
  if (target.passwordHash) return { ok: false, message: `${target.name} has already activated their account.` };

  const inviteToken = generateToken();
  db.authTokens.set(inviteToken, {
    token: inviteToken,
    userId,
    purpose: "invite",
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  });
  saveDb();

  const inviteUrl = `${await getAppUrl()}/accept-invite?token=${inviteToken}`;
  const roleLabel = target.role.replace("_", " ").toLowerCase();
  const emailResult = await sendEmail({
    to: target.email,
    subject: "You've been added to Equity Flow Group",
    text: `Hi ${target.name.split(" ")[0]},\n\n${user.name} added you to Equity Flow Group as ${roleLabel}. Set your password to get started:\n${inviteUrl}\n\nThis link expires in 7 days.\n\n— Equity Flow Group`,
    idempotencyKey: newId("idem"),
    from: `${db.config.senderName} <${db.config.senderEmail}>`,
  });

  await audit(user.id, user.name, "RESEND_INVITE", "User", userId, "ALLOW");
  if (!emailResult.ok) {
    return { ok: false, message: `Could not resend the invite: ${emailResult.failure.message}` };
  }
  return { ok: true, message: `Invite resent to ${target.email}${emailResult.simulated ? " (simulated)" : ""}.` };
}

export async function updateOfficerProductTypesAction(officerId: string, productTypes: LoanIntent[]): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (user.role !== "ADMIN") {
    return { ok: false, message: "Only Admin can change what an officer accepts." };
  }
  const db = await getDb();
  const officer = db.officers.get(officerId);
  if (!officer) return { ok: false, message: "Officer not found." };

  officer.productTypes = productTypes;
  await audit(user.id, user.name, "UPDATE_OFFICER_PRODUCT_TYPES", "Officer", officerId, "ALLOW");
  saveDb();
  revalidatePath("/workspace/admin");
  return {
    ok: true,
    message: productTypes.length > 0 ? `${officer.name} now accepts: ${productTypes.map((p) => p.replace("_", " ").toLowerCase()).join(", ")}.` : `${officer.name} isn't accepting any product types — they won't be routed new leads.`,
  };
}

export interface UpdateOfficerInput {
  licensedStates: string[];
  dailyCapacity: number;
  activeHoursStart: number;
  activeHoursEnd: number;
  isActive: boolean;
}

// Previously the only editable officer field post-creation was product
// types — capacity, licensed states, active hours, and active/inactive
// status were all set once at creation and then frozen, even though these
// are exactly the levers an admin needs when redistributing load or taking
// an officer offline for vacation.
export async function updateOfficerAction(officerId: string, input: UpdateOfficerInput): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (user.role !== "ADMIN") {
    return { ok: false, message: "Only Admin can edit officer profiles." };
  }
  if (input.dailyCapacity < 1) return { ok: false, message: "Daily capacity must be at least 1." };
  if (input.activeHoursStart < 0 || input.activeHoursStart > 23 || input.activeHoursEnd < 1 || input.activeHoursEnd > 24 || input.activeHoursStart >= input.activeHoursEnd) {
    return { ok: false, message: "Active hours must be a valid 0-24 range with start before end." };
  }

  const db = await getDb();
  const officer = db.officers.get(officerId);
  if (!officer) return { ok: false, message: "Officer not found." };

  officer.licensedStates = input.licensedStates;
  officer.dailyCapacity = input.dailyCapacity;
  officer.activeHoursStart = input.activeHoursStart;
  officer.activeHoursEnd = input.activeHoursEnd;
  officer.isActive = input.isActive;

  await audit(user.id, user.name, "UPDATE_OFFICER", "Officer", officerId, "ALLOW");
  saveDb();
  revalidatePath("/workspace/admin");
  return { ok: true, message: `${officer.name}'s profile updated.` };
}

// ---------------------------------------------------------------------------
// Manual task creation
// ---------------------------------------------------------------------------
export async function createTaskAction(publicRef: string, type: TaskType, title: string, dueInHours: number, assigneeId?: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  const lead = await requireLead(publicRef);
  if (!title.trim()) return { ok: false, message: "Task title is required." };

  const db = await getDb();
  const taskId = newId("task");
  db.tasks.set(taskId, {
    id: taskId,
    leadId: lead.id,
    type,
    assigneeId,
    dueAt: new Date(Date.now() + dueInHours * 3_600_000).toISOString(),
    status: "OPEN",
    title: title.trim(),
  });

  await pushEvent({
    leadId: lead.id,
    type: "NOTE_ADDED",
    actorType: user.role === "OFFICER" ? "OFFICER" : "ADMIN",
    actorId: user.id,
    actorName: user.name,
    occurredAt: nowIso(),
    payload: { taskCreated: title.trim() },
  });
  revalidateLead(publicRef);
  return { ok: true, message: "Task created." };
}

export async function completeTaskAction(publicRef: string, taskId: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  await requireLead(publicRef);
  const db = await getDb();
  const task = db.tasks.get(taskId);
  if (!task) return { ok: false, message: "Task not found." };

  task.status = "COMPLETED";
  task.completedAt = nowIso();
  task.completedById = user.id;
  saveDb();
  revalidateLead(publicRef);
  return { ok: true, message: "Task completed." };
}

// Post-action follow-up: pushing a task's due date out, instead of either
// completing it (loses the reminder) or leaving it to just sit overdue.
export async function snoozeTaskAction(publicRef: string, taskId: string, snoozeHours: number): Promise<ActionResult> {
  await requireLead(publicRef);
  const db = await getDb();
  const task = db.tasks.get(taskId);
  if (!task) return { ok: false, message: "Task not found." };
  if (task.status !== "OPEN") return { ok: false, message: "Only open tasks can be snoozed." };

  task.dueAt = new Date(Date.now() + snoozeHours * 3_600_000).toISOString();
  saveDb();
  revalidateLead(publicRef);
  return { ok: true, message: `Snoozed to ${formatDateTime(task.dueAt)}.` };
}

// ---------------------------------------------------------------------------
// Email & SMS compose — human-reviewed AI drafts, full send history.
// ---------------------------------------------------------------------------
export async function getComposeContextAction(publicRef: string): Promise<{
  toEmail: string;
  toPhone: string;
  toName: string;
  intent: LoanIntent;
  officerFirstName: string;
  senderName: string;
  senderEmail: string;
}> {
  const lead = await requireLead(publicRef);
  const db = await getDb();
  const person = Array.from(db.people.values()).find((p) => p.leadId === lead.id && p.role === "PRIMARY");
  const user = await getCurrentUser();
  return {
    toEmail: person?.email ?? "",
    toPhone: person?.phoneE164 ?? "",
    toName: person?.firstName ?? "there",
    intent: lead.intent,
    officerFirstName: user.name.split(" ")[0],
    senderName: db.config.senderName,
    senderEmail: db.config.senderEmail,
  };
}

export async function generateDraftAction(publicRef: string, channel: "EMAIL" | "SMS"): Promise<{ subject?: string; body: string; simulated: boolean }> {
  const lead = await requireLead(publicRef);
  const db = await getDb();
  const person = Array.from(db.people.values()).find((p) => p.leadId === lead.id && p.role === "PRIMARY");
  const user = await getCurrentUser();

  if (channel === "EMAIL") {
    return generateOutreachContent({
      channel: "EMAIL",
      firstName: person?.firstName ?? "there",
      intent: lead.intent,
      goal: lead.goal,
      officerFirstName: user.name.split(" ")[0],
      isFirstContact: !lead.firstContactAt,
    });
  }
  const content = await generateOutreachContent({
    channel: "VOICE",
    firstName: person?.firstName ?? "there",
    intent: lead.intent,
    goal: lead.goal,
    officerFirstName: user.name.split(" ")[0],
    isFirstContact: !lead.firstContactAt,
  });
  return { body: content.body.length > 160 ? content.body.slice(0, 157) + "..." : content.body, simulated: content.simulated };
}

export async function sendEmailAction(publicRef: string, subject: string, body: string, toEmail?: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  const lead = await requireLead(publicRef);
  if (!can({ role: user.role, officerId: user.officerId }, "CALL_NOW", lead)) {
    return { ok: false, message: "You don't have permission to contact this lead." };
  }
  if (!subject.trim()) return { ok: false, message: "Email subject cannot be empty." };
  if (!body.trim()) return { ok: false, message: "Email body cannot be empty." };
  if (toEmail !== undefined && !toEmail.includes("@")) return { ok: false, message: "Enter a valid recipient email." };

  const decision = await evaluateForLead(lead, "EMAIL", true);
  const db = await getDb();
  db.policyDecisions.push({
    id: newId("policy"),
    leadId: lead.id,
    channel: "EMAIL",
    decision: decision.decision,
    reasons: decision.reasons,
    evaluatedAt: nowIso(),
    nextPermittedAt: decision.nextPermittedAt?.toISOString(),
    inputSnapshot: await buildGateInput(lead, "EMAIL", true) as unknown as Record<string, unknown>,
  });

  if (decision.decision !== "ALLOW") {
    await pushEvent({ leadId: lead.id, type: "OUTREACH_BLOCKED", actorType: "OFFICER", actorId: user.id, actorName: user.name, channel: "EMAIL", occurredAt: nowIso(), payload: { reasons: decision.reasons, manual: true } });
    revalidateLead(publicRef);
    return { ok: false, message: `Blocked by PolicyGate: ${decision.reasons.join(", ")}` };
  }

  const person = Array.from(db.people.values()).find((p) => p.leadId === lead.id && p.role === "PRIMARY");
  const recipient = toEmail || person?.email || "";
  if (person && toEmail && toEmail !== person.email) person.email = toEmail;
  const idempotencyKey = newId("idem");
  const result = await sendEmail({
    to: recipient,
    subject,
    text: body,
    idempotencyKey,
    from: `${db.config.senderName} <${db.config.senderEmail}>`,
  });

  lead.attemptsTotal += 1;
  lead.attemptsToday += 1;
  lead.lastAttemptAt = nowIso();
  if (!lead.firstContactAt) lead.firstContactAt = nowIso();
  lead.lastContactAt = nowIso();
  if (lead.state === "NEW") lead.state = transition(lead.state, "OUTREACH_ATTEMPTED");
  lead.updatedAt = nowIso();

  db.attempts.push({
    id: newId("attempt"),
    leadId: lead.id,
    channel: "EMAIL",
    direction: "OUTBOUND",
    idempotencyKey,
    providerMessageId: result.ok ? result.providerMessageId : undefined,
    outcome: result.ok ? "SENT" : "FAILED",
    failureClass: result.ok ? undefined : result.failure.class,
    failureMessage: result.ok ? undefined : result.failure.message,
    attemptNumber: lead.attemptsTotal,
    scheduledFor: nowIso(),
    startedAt: nowIso(),
    subject,
    body,
    loggedById: user.id,
    loggedByName: user.name,
  });

  if (!result.ok) {
    // A failed send did not reach the borrower, so it must not count against
    // the attempt caps that exist to limit how often they are contacted.
    await recordSendFailure(db, lead, person, "EMAIL", result.failure, user, true);
    revalidateLead(publicRef);
    return { ok: false, message: describeFailure("EMAIL", result.failure) };
  }

  await pushEvent({ leadId: lead.id, type: "OUTREACH_ATTEMPTED", actorType: "OFFICER", actorId: user.id, actorName: user.name, channel: "EMAIL", occurredAt: nowIso(), payload: { manual: true, simulated: result.simulated } });
  revalidateLead(publicRef);
  return { ok: true, message: result.simulated ? "Email queued (simulated — no provider configured)." : "Email sent to provider. Delivery will confirm shortly." };
}

export async function sendSmsComposedAction(publicRef: string, body: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  const lead = await requireLead(publicRef);
  if (!can({ role: user.role, officerId: user.officerId }, "CALL_NOW", lead)) {
    return { ok: false, message: "You don't have permission to contact this lead." };
  }
  if (!body.trim()) return { ok: false, message: "Message cannot be empty." };

  const decision = await evaluateForLead(lead, "SMS", true);
  const db = await getDb();
  db.policyDecisions.push({
    id: newId("policy"),
    leadId: lead.id,
    channel: "SMS",
    decision: decision.decision,
    reasons: decision.reasons,
    evaluatedAt: nowIso(),
    nextPermittedAt: decision.nextPermittedAt?.toISOString(),
    inputSnapshot: await buildGateInput(lead, "SMS", true) as unknown as Record<string, unknown>,
  });

  if (decision.decision !== "ALLOW") {
    await pushEvent({ leadId: lead.id, type: "OUTREACH_BLOCKED", actorType: "OFFICER", actorId: user.id, actorName: user.name, channel: "SMS", occurredAt: nowIso(), payload: { reasons: decision.reasons, manual: true } });
    revalidateLead(publicRef);
    return { ok: false, message: `Blocked by PolicyGate: ${decision.reasons.join(", ")}` };
  }

  const person = Array.from(db.people.values()).find((p) => p.leadId === lead.id && p.role === "PRIMARY");
  const idempotencyKey = newId("idem");
  const result = await sendSms({ to: person?.phoneE164 ?? "", body, idempotencyKey });

  lead.attemptsTotal += 1;
  lead.attemptsToday += 1;
  lead.lastAttemptAt = nowIso();
  if (!lead.firstContactAt) lead.firstContactAt = nowIso();
  lead.lastContactAt = nowIso();
  if (lead.state === "NEW") lead.state = transition(lead.state, "OUTREACH_ATTEMPTED");
  lead.updatedAt = nowIso();

  db.attempts.push({
    id: newId("attempt"),
    leadId: lead.id,
    channel: "SMS",
    direction: "OUTBOUND",
    idempotencyKey,
    providerMessageId: result.ok ? result.providerMessageId : undefined,
    outcome: result.ok ? "SENT" : "FAILED",
    failureClass: result.ok ? undefined : result.failure.class,
    failureMessage: result.ok ? undefined : result.failure.message,
    attemptNumber: lead.attemptsTotal,
    scheduledFor: nowIso(),
    startedAt: nowIso(),
    body,
    loggedById: user.id,
    loggedByName: user.name,
  });

  if (!result.ok) {
    await recordSendFailure(db, lead, person, "SMS", result.failure, user, true);
    revalidateLead(publicRef);
    return { ok: false, message: describeFailure("SMS", result.failure) };
  }

  await pushEvent({ leadId: lead.id, type: "OUTREACH_ATTEMPTED", actorType: "OFFICER", actorId: user.id, actorName: user.name, channel: "SMS", occurredAt: nowIso(), payload: { manual: true, simulated: result.simulated } });
  revalidateLead(publicRef);
  return { ok: true, message: result.simulated ? "Text queued (simulated — no provider configured)." : "Text sent to carrier. Delivery will confirm shortly." };
}

// ---------------------------------------------------------------------------
// Dialer — same PolicyGate check as callNowAction, but the UI drives a
// simulated ringing/connected call experience and lets the officer record
// the real outcome once the call ends, rather than assuming SENT.
// ---------------------------------------------------------------------------
export interface DialerStartResult extends ActionResult {
  attemptId?: string;
  script?: string;
  simulated?: boolean;
  mechanism?: VoiceMechanism;
  strategyReason?: string;
  strategyRemedy?: string;
  degraded?: boolean;
}

export async function startDialerCallAction(publicRef: string): Promise<DialerStartResult> {
  const user = await getCurrentUser();
  const lead = await requireLead(publicRef);
  if (!can({ role: user.role, officerId: user.officerId }, "CALL_NOW", lead)) {
    return { ok: false, message: "You don't have permission to contact this lead." };
  }

  const decision = await evaluateForLead(lead, "VOICE", true);
  const db = await getDb();
  db.policyDecisions.push({
    id: newId("policy"),
    leadId: lead.id,
    channel: "VOICE",
    decision: decision.decision,
    reasons: decision.reasons,
    evaluatedAt: nowIso(),
    nextPermittedAt: decision.nextPermittedAt?.toISOString(),
    inputSnapshot: await buildGateInput(lead, "VOICE", true) as unknown as Record<string, unknown>,
  });

  if (decision.decision !== "ALLOW") {
    await pushEvent({ leadId: lead.id, type: "OUTREACH_BLOCKED", actorType: "OFFICER", actorId: user.id, actorName: user.name, channel: "VOICE", occurredAt: nowIso(), payload: { reasons: decision.reasons, manual: true } });
    revalidateLead(publicRef);
    return {
      ok: false,
      message: `Blocked by PolicyGate: ${decision.reasons.join(", ")}${decision.nextPermittedAt ? ` — next permitted at ${decision.nextPermittedAt.toLocaleString()}` : ""}`,
    };
  }

  const person = Array.from(db.people.values()).find((p) => p.leadId === lead.id && p.role === "PRIMARY");

  // One orchestrator decides the mechanism (Vapi conversation preferred,
  // Twilio announcement as a labelled fallback) and carries the borrower's
  // existing SMS/email thread into the call.
  const outcome = await placeOutboundCall(db, lead, person, user);

  if (!outcome.ok && outcome.failure) {
    await recordSendFailure(db, lead, person, "VOICE", outcome.failure, user);
    saveDb();
    revalidateLead(publicRef);
    return { ok: false, message: describeFailure("VOICE", outcome.failure) };
  }

  lead.attemptsTotal += 1;
  lead.attemptsToday += 1;
  lead.lastAttemptAt = nowIso();
  if (!lead.firstContactAt) lead.firstContactAt = nowIso();
  lead.updatedAt = nowIso();

  await pushEvent({
    leadId: lead.id,
    type: "OUTREACH_ATTEMPTED",
    actorType: "OFFICER",
    actorId: user.id,
    actorName: user.name,
    channel: "VOICE",
    occurredAt: nowIso(),
    payload: { manual: true, mechanism: outcome.strategy.mechanism, simulated: outcome.simulated },
  });

  saveDb();
  return {
    ok: true,
    message: outcome.simulated ? "Simulated call — no voice provider connected." : "Dialing…",
    attemptId: outcome.attemptId,
    script: outcome.script,
    simulated: outcome.simulated,
    mechanism: outcome.strategy.mechanism,
    strategyReason: outcome.strategy.reason,
    strategyRemedy: outcome.strategy.remedy,
    degraded: outcome.strategy.degraded,
  };
}

export async function endDialerCallAction(publicRef: string, attemptId: string, outcome: AttemptOutcome, durationSec: number, notes: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  const lead = await requireLead(publicRef);
  const db = await getDb();
  const attempt = db.attempts.find((a) => a.id === attemptId && a.leadId === lead.id);
  if (!attempt) return { ok: false, message: "Call record not found." };

  attempt.outcome = outcome;
  attempt.endedAt = nowIso();
  attempt.durationSec = durationSec;

  lead.attemptsTotal += 1;
  lead.attemptsToday += 1;
  lead.lastAttemptAt = nowIso();
  if (!lead.firstContactAt) lead.firstContactAt = nowIso();
  lead.lastContactAt = nowIso();
  if (lead.state === "NEW") {
    try {
      lead.state = transition(lead.state, "OUTREACH_ATTEMPTED");
    } catch {
      /* ignore if not a valid transition from current state */
    }
  } else if (outcome === "ANSWERED" && lead.state === "ATTEMPTING_CONTACT") {
    try {
      lead.state = transition(lead.state, "CONTACT_ANSWERED");
    } catch {
      /* ignore */
    }
  }
  lead.updatedAt = nowIso();

  await pushEvent({
    leadId: lead.id,
    type: outcome === "ANSWERED" ? "CONTACT_ANSWERED" : "OUTREACH_ATTEMPTED",
    actorType: "OFFICER",
    actorId: user.id,
    actorName: user.name,
    channel: "VOICE",
    occurredAt: nowIso(),
    payload: { manual: true, outcome, durationSec, notes: notes.trim() || undefined },
  });
  if (notes.trim()) {
    db.notes.push({ id: newId("note"), leadId: lead.id, authorId: user.id, authorName: user.name, body: `Call note: ${notes.trim()}`, createdAt: nowIso() });
  }
  await audit(user.id, user.name, "DIALER_CALL_ENDED", "ContactAttempt", attemptId, "ALLOW");

  // Missed-call SMS fallback — don't wait for the next scheduled cadence
  // step when we already know right now that voice didn't land.
  let fallbackSms: DeliverOutreachResult | null = null;
  if (outcome === "NO_ANSWER" || outcome === "VOICEMAIL" || outcome === "BUSY") {
    fallbackSms = await deliverOutreach(db, lead, "SMS", "SYSTEM", `missed_call_fallback_${outcome.toLowerCase()}`);
  }

  saveDb();
  revalidateLead(publicRef);
  return {
    ok: true,
    message: fallbackSms?.ok ? "Call logged — follow-up text sent automatically." : "Call logged.",
  };
}

// ---------------------------------------------------------------------------
// Live AI voice-agent call (SPEC.md F-05) — see adapters/voiceAgent.ts and
// app/api/webhooks/vapi/route.ts for the outbound-call + transcript-ingestion
// halves of this. Same PolicyGate/RBAC gating as the human-officer dialer.
// ---------------------------------------------------------------------------
export async function startVoiceAgentCallAction(publicRef: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  const lead = await requireLead(publicRef);
  if (!can({ role: user.role, officerId: user.officerId }, "CALL_NOW", lead)) {
    return { ok: false, message: "You don't have permission to contact this lead." };
  }

  const decision = await evaluateForLead(lead, "VOICE", true);
  const db = await getDb();
  db.policyDecisions.push({
    id: newId("policy"),
    leadId: lead.id,
    channel: "VOICE",
    decision: decision.decision,
    reasons: decision.reasons,
    evaluatedAt: nowIso(),
    nextPermittedAt: decision.nextPermittedAt?.toISOString(),
    inputSnapshot: (await buildGateInput(lead, "VOICE", true)) as unknown as Record<string, unknown>,
  });

  if (decision.decision !== "ALLOW") {
    await pushEvent({ leadId: lead.id, type: "OUTREACH_BLOCKED", actorType: "OFFICER", actorId: user.id, actorName: user.name, channel: "VOICE", occurredAt: nowIso(), payload: { reasons: decision.reasons, manual: true } });
    revalidateLead(publicRef);
    return { ok: false, message: `Blocked by PolicyGate: ${decision.reasons.join(", ")}` };
  }

  const person = Array.from(db.people.values()).find((p) => p.leadId === lead.id && p.role === "PRIMARY");
  if (!person) return { ok: false, message: "No contact on file for this lead." };

  // Same orchestrator as the Call button — there is only one way to place a
  // call now. This action remains so the AI-call entry point keeps working,
  // but it no longer represents a separate mechanism.
  const outcome = await placeOutboundCall(db, lead, person, user);

  if (!outcome.ok && outcome.failure) {
    await recordSendFailure(db, lead, person, "VOICE", outcome.failure, user);
    saveDb();
    revalidateLead(publicRef);
    return { ok: false, message: describeFailure("VOICE", outcome.failure) };
  }

  lead.attemptsTotal += 1;
  lead.attemptsToday += 1;
  lead.lastAttemptAt = nowIso();
  if (!lead.firstContactAt) lead.firstContactAt = nowIso();
  lead.updatedAt = nowIso();

  await pushEvent({
    leadId: lead.id,
    type: "OUTREACH_ATTEMPTED",
    actorType: "OFFICER",
    actorId: user.id,
    actorName: user.name,
    channel: "VOICE",
    occurredAt: nowIso(),
    payload: { manual: true, mechanism: outcome.strategy.mechanism, simulated: outcome.simulated },
  });

  saveDb();
  revalidateLead(publicRef);

  if (outcome.strategy.degraded) {
    return {
      ok: true,
      message: `${outcome.strategy.reason}${outcome.strategy.remedy ? ` ${outcome.strategy.remedy}` : ""}`,
    };
  }
  return { ok: true, message: outcome.simulated ? "Simulated AI call — no voice provider connected." : "AI agent is calling now." };
}

// ---------------------------------------------------------------------------
// Public intake (F-01) — the one unauthenticated write path.
// ---------------------------------------------------------------------------

/** The intake payload, derived from the validation schema so the runtime
 *  check and the compile-time type can never disagree. */
export type IntakeInput = z.infer<typeof intakeInputSchema>;

export interface IntakeResult {
  ok: boolean;
  publicRef?: string;
  slaDueAt?: string;
  referralType?: ReferralType;
  /** Per-field messages, keyed by field name, for re-display on the form. */
  fieldErrors?: Record<string, string>;
  message?: string;
}

export async function submitIntakeAction(input: IntakeInput, clientDraftId?: string): Promise<IntakeResult> {
  // This is the one public, unauthenticated write path in the whole app —
  // real schema validation (type/length/enum bounds) belongs right here,
  // not just a truthiness check, since anyone can POST to it directly.
  const parsed = intakeInputSchema.safeParse(input);
  const fieldErrors: Record<string, string> = {};
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0] ?? "form");
      if (!fieldErrors[field]) fieldErrors[field] = issue.message;
    }
  }

  const phone = normalizePhone(input.phone);
  if (!phone) fieldErrors.phone = "Enter a valid US phone number";

  if (Object.keys(fieldErrors).length > 0 || !phone) {
    return { ok: false, fieldErrors };
  }

  const db = await getDb();

  // Suppressed phone → create lead SUPPRESSED, skip all outreach, neutral response.
  const suppressed = db.suppressions.get(phone);

  const leadId = newId("lead");
  const personId = newId("person");
  const publicRef = nanoid(10);
  const createdAt = nowIso();
  const timezone = STATE_TIMEZONE[input.stateCode] ?? "UNKNOWN";

  const identity = await validateIntakeIdentity({ firstName: input.firstName, lastName: input.lastName, email: input.email });

  db.people.set(personId, {
    id: personId,
    leadId,
    role: "PRIMARY",
    firstName: identity.firstName,
    lastName: identity.lastName,
    phoneE164: phone,
    email: input.email.trim(),
    preferredContactWindow: input.bestContactTime,
    timezone,
    ...(identity.flags.length > 0 ? { dataQualityFlags: identity.flags } : {}),
  });

  const consentDefs: { scope: ConsentRecord["scope"]; granted: boolean; disclosureVersionId: string }[] = [
    { scope: "CONTACT_VOICE", granted: input.consents.voice, disclosureVersionId: "disc_tcpa_voice_v2" },
    { scope: "CONTACT_SMS", granted: input.consents.sms, disclosureVersionId: "disc_tcpa_sms_v3" },
    { scope: "CONTACT_EMAIL", granted: input.consents.email, disclosureVersionId: "disc_email_v1" },
    { scope: "RECORDING", granted: input.consents.recording, disclosureVersionId: "disc_recording_v1" },
  ];
  for (const c of consentDefs) {
    db.consents.push({
      id: newId("consent"),
      leadId,
      personId,
      scope: c.scope,
      granted: c.granted,
      disclosureVersionId: c.disclosureVersionId,
      exactTextSnapshot: db.disclosures.get(c.disclosureVersionId)?.bodyText ?? "",
      capturedAt: createdAt,
      sourceUrl: "https://apply.equityflowgroup.com/intake",
      ipAddress: "203.0.113.10",
      userAgent: "demo-ui",
      sessionId: newId("sess"),
      formFingerprint: newId("fp"),
    });
  }

  const allConsentsFalse = !input.consents.voice && !input.consents.sms && !input.consents.email;
  const slaDueAt = new Date(Date.now() + db.config.firstContactSlaMinutes * 60_000).toISOString();
  const referralType = classifyReferral(input.missedPayments);
  const cadencePlanVersionId = resolveCadence(Array.from(db.cadencePlans.values()), {
    sourceId: "web_organic",
    stateCode: input.stateCode,
    intent: input.intent,
  }).id;

  const lead: Lead = {
    id: leadId,
    publicRef,
    state: suppressed ? "SUPPRESSED" : allConsentsFalse ? "NURTURE" : "NEW",
    intent: input.intent,
    goal: input.goal,
    timeline: input.timeline,
    creditRange: input.creditRange,
    missedPayments: input.missedPayments,
    referralType,
    hasExistingHomeEquityLoan: input.hasExistingHomeEquityLoan,
    intakeDurationSeconds: input.intakeDurationSeconds,
    sourceId: "web_organic",
    stateCode: input.stateCode,
    city: input.city,
    addressLine1: input.addressLine1,
    occupancy: input.occupancy,
    estimatedValue: input.estimatedValue,
    currentBalance: input.currentBalance,
    cadencePlanVersionId,
    slaDueAt,
    completenessScore: 0,
    createdAt,
    updatedAt: createdAt,
    attemptsToday: 0,
    attemptsTotal: 0,
    lastAttemptAt: null,
  };
  db.leads.set(leadId, lead);

  // Form-submitted answers are real, sourced field values (SPEC.md F-06/F-07
  // source precedence: OFFICER_ENTERED > FORM > BORROWER_STATED > PROVIDER) —
  // record them so completeness scoring (queries.ts computeLeadCompleteness)
  // sees a freshly-submitted lead as already partially complete instead of
  // 0/100. contact.reachable and borrower.incomeBand are legitimately left
  // unset here: reachability isn't known until a contact attempt, and income
  // isn't asked on this form.
  const setFormField = (fieldPath: string, value: unknown, confidence = 0.95) => {
    db.leadFields.set(`${leadId}:${fieldPath}`, {
      id: newId("field"),
      leadId,
      fieldPath,
      value,
      status: "CONFIRMED",
      confidence,
      sourceType: "FORM",
      collectedAt: createdAt,
      verificationStatus: "UNVERIFIED",
      supersededCandidateIds: [],
    });
  };
  setFormField("loan.intent", input.intent);
  setFormField("loan.purpose", input.goal);
  setFormField("property.occupancy", input.occupancy);
  setFormField("borrower.timeline", input.timeline);
  setFormField("borrower.creditBand", input.creditRange);
  if (input.city && input.stateCode) setFormField("property.identified", true, 0.9);

  await pushEvent({
    leadId,
    type: suppressed ? "SUPPRESSED_ON_INTAKE" : "LEAD_CREATED",
    actorType: "BORROWER",
    occurredAt: createdAt,
    payload: { intent: input.intent, goal: input.goal, allConsentsFalse, missedPayments: input.missedPayments, referralType },
  });

  if (!suppressed) {
    const taskId = newId("task");
    db.tasks.set(taskId, {
      id: taskId,
      leadId,
      type: "FIRST_CONTACT",
      dueAt: slaDueAt,
      status: allConsentsFalse ? "CANCELLED" : "OPEN",
      title: "First contact attempt due",
    });

    // Not disqualified — routed. A borrower who can't qualify for refi/equity
    // still has a monetizable next step (loan-mod or foreclosure referral).
    if (referralType !== "NONE") {
      const referralTaskId = newId("task");
      db.tasks.set(referralTaskId, {
        id: referralTaskId,
        leadId,
        type: "FOLLOW_UP",
        dueAt: slaDueAt,
        status: "OPEN",
        title:
          referralType === "FORECLOSURE"
            ? "Route to foreclosure specialist partner (3+ missed payments)"
            : "Route to loan modification partner (1-2 missed payments)",
      });
    }
  }

  // Scientific lead-quality scoring (Equity Flow Group business plan §5) —
  // routes hot leads to an instant officer alert instead of waiting for the
  // standard cadence. Uses the AVM's simulated valuation as a fallback for
  // whatever the borrower didn't self-report.
  if (!suppressed) {
    const valuation = await getPropertyValuation({
      addressLine1: input.addressLine1,
      city: input.city,
      stateCode: input.stateCode,
      estimatedValue: input.estimatedValue,
    });
    // Cache on the lead itself so later reads (lead detail page, quality
    // re-scoring) reuse this instead of re-hitting a metered AVM vendor.
    lead.propertyValuation = valuation;
    const score = computeLeadQualityScore(
      {
        stateCode: input.stateCode,
        intent: input.intent,
        goal: input.goal,
        timeline: input.timeline,
        missedPayments: input.missedPayments,
        estimatedValue: input.estimatedValue ?? valuation.estimatedValue,
        mortgageBalance: input.currentBalance ?? valuation.estimatedMortgageBalance,
        intakeDurationSeconds: input.intakeDurationSeconds,
      },
      db.config.scoringWeights,
      db.config.hotLeadThreshold
    );

    await pushEvent({
      leadId,
      type: "HOT_LEAD_SCORED",
      actorType: "SYSTEM",
      occurredAt: nowIso(),
      payload: { total: score.total, tier: score.tier, breakdown: score.breakdown, ltv: score.ltv },
    });

    if (score.tier === "HOT") {
      const officer = await autoAssignOfficer(db, lead, "hot_lead_score");
      const alertTaskId = newId("task");
      db.tasks.set(alertTaskId, {
        id: alertTaskId,
        leadId,
        type: "HOT_LEAD_ALERT",
        dueAt: createdAt,
        status: "OPEN",
        title: `HOT LEAD (${score.total}/100) — call within minutes`,
      });
      if (officer?.phone) {
        const phone = normalizePhone(officer.phone);
        if (phone) {
          const alertResult = await sendSms({
            to: phone,
            body: `🔥 Hot lead (${score.total}/100): ${input.firstName} ${input.lastName} in ${input.city ?? ""}, ${input.stateCode} — ${input.intent.replace("_", " ").toLowerCase()}. Ref ${publicRef}. Call now.`,
            idempotencyKey: newId("idem"),
          });
          // The whole point of a hot-lead alert is speed. If the text didn't
          // go out, the officer is not on their way — so the in-app task has
          // to say so rather than sitting there implying they were paged.
          if (!alertResult.ok) {
            const t = db.tasks.get(alertTaskId);
            if (t) t.title = `HOT LEAD (${score.total}/100) — SMS ALERT FAILED, officer not paged. Call within minutes.`;
            console.error(`[hotLeadAlert] could not page officer ${officer.id}: ${alertResult.failure.message}`);
          }
        }
      }
    }
  }

  // A completed, consented submission supersedes whatever pre-consent draft
  // led here — leaving it around would just be a second, redundant copy of
  // the same PII sitting outside the consent-gated pipeline.
  if (clientDraftId) db.intakeDrafts.delete(clientDraftId);

  saveDb();
  revalidatePath("/workspace/leads");
  revalidatePath("/workspace");
  return { ok: true, publicRef, slaDueAt, referralType };
}

// Autosaves a visitor's in-progress intake form before they've consented to
// anything — see IntakeDraft's own comment for why this deliberately never
// touches db.leads. No schema validation: a draft is allowed to be
// incomplete by definition, and this is the one write path in the app that
// intentionally accepts a same-origin request with almost no shape checking
// on the payload (bounded only by the size below), since blocking on
// validation would defeat the point of an autosave.
const MAX_DRAFT_SNAPSHOT_BYTES = 20_000;

export async function saveIntakeDraftAction(clientDraftId: string, furthestStep: number, formSnapshot: Record<string, unknown>): Promise<ActionResult> {
  if (!clientDraftId || typeof clientDraftId !== "string" || clientDraftId.length > 64) {
    return { ok: false, message: "Invalid draft id." };
  }
  if (JSON.stringify(formSnapshot).length > MAX_DRAFT_SNAPSHOT_BYTES) {
    return { ok: false, message: "Draft payload too large." };
  }

  const db = await getDb();
  const existing = db.intakeDrafts.get(clientDraftId);
  const now = nowIso();
  db.intakeDrafts.set(clientDraftId, {
    id: clientDraftId,
    clientDraftId,
    formSnapshot,
    furthestStep,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
  saveDb();
  return { ok: true, message: "Draft saved." };
}

/** Public — called by the borrower's own browser when they click "Start
 *  over" on the intake form. No auth check by design: same trust model as
 *  saveIntakeDraftAction itself (an anonymous visitor discarding their own
 *  in-progress, not-yet-consented data), gated only by knowing the random
 *  client-generated id, which never leaves their own browser's localStorage. */
export async function discardIntakeDraftAction(clientDraftId: string): Promise<ActionResult> {
  if (!clientDraftId || typeof clientDraftId !== "string") return { ok: false, message: "Invalid draft id." };
  const db = await getDb();
  db.intakeDrafts.delete(clientDraftId);
  saveDb();
  return { ok: true, message: "Draft discarded." };
}

/** Admin-only — deleting someone else's draft from the ops-facing panel
 *  (e.g. a right-to-delete request), as opposed to discardIntakeDraftAction
 *  above which is the borrower discarding their own. */
export async function deleteIntakeDraftAction(draftId: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (user.role !== "ADMIN") {
    return { ok: false, message: "Only Admin can delete an intake draft." };
  }
  const db = await getDb();
  if (!db.intakeDrafts.delete(draftId)) {
    return { ok: false, message: "Draft not found." };
  }
  await audit(user.id, user.name, "DELETE_INTAKE_DRAFT", "IntakeDraft", draftId, "ALLOW");
  saveDb();
  revalidatePath("/workspace/admin");
  return { ok: true, message: "Draft deleted." };
}

// "Connect the loan officer in the background" — route to the best-fit
// available officer immediately instead of leaving a hot lead unassigned in
// the queue while the borrower is still engaged.
export async function autoAssignOfficer(db: Database, lead: Lead, reason: string) {
  if (lead.assignedOfficerId) return db.officers.get(lead.assignedOfficerId);
  // Computed from today's OFFICER_ASSIGNED events, not the stored
  // currentLoad counter — see computeOfficerLoadToday for why (that
  // counter never reset, so "daily" capacity was actually a lifetime cap).
  const loadToday = new Map(Array.from(db.officers.values()).map((o) => [o.id, computeOfficerLoadToday(db.events, o.id)]));
  const officer = Array.from(db.officers.values())
    .filter(
      (o) =>
        o.isActive &&
        o.licensedStates.includes(lead.stateCode) &&
        o.productTypes.includes(lead.intent) &&
        (loadToday.get(o.id) ?? 0) < o.dailyCapacity
    )
    .sort((a, b) => (loadToday.get(a.id) ?? 0) - (loadToday.get(b.id) ?? 0))[0];
  if (!officer) return undefined;
  lead.assignedOfficerId = officer.id;
  await pushEvent({
    leadId: lead.id,
    type: "OFFICER_ASSIGNED",
    actorType: "SYSTEM",
    occurredAt: nowIso(),
    payload: { officerId: officer.id, reason },
  });
  return officer;
}

export async function requestPriorityCallbackAction(publicRef: string): Promise<ActionResult> {
  const lead = await requireLead(publicRef);
  const db = await getDb();
  const taskId = newId("task");
  db.tasks.set(taskId, {
    id: taskId,
    leadId: lead.id,
    type: "PRIORITY_CALLBACK_REQUESTED",
    dueAt: nowIso(),
    status: "OPEN",
    title: "Borrower asked for an immediate callback in the post-submit chat",
  });
  await pushEvent({ leadId: lead.id, type: "PRIORITY_CALLBACK_REQUESTED", actorType: "BORROWER", occurredAt: nowIso(), payload: {} });
  await autoAssignOfficer(db, lead, "priority_callback_request");

  saveDb();
  revalidateLead(publicRef);
  return { ok: true, message: "Got it — flagged for an immediate callback." };
}

export async function updateContactInfoAction(publicRef: string, phone: string, email: string): Promise<ActionResult> {
  const lead = await requireLead(publicRef);
  const db = await getDb();
  const person = Array.from(db.people.values()).find((p) => p.leadId === lead.id && p.role === "PRIMARY");
  if (!person) return { ok: false, message: "We couldn't find your contact record — send us a message instead." };

  const normalizedPhone = phone.trim() ? normalizePhone(phone) : person.phoneE164;
  if (phone.trim() && !normalizedPhone) return { ok: false, message: "That phone number doesn't look valid — use a 10-digit US number." };
  const trimmedEmail = email.trim();
  if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
    return { ok: false, message: "That email address doesn't look valid." };
  }

  const previousPhone = person.phoneE164;
  const previousEmail = person.email;
  if (normalizedPhone) person.phoneE164 = normalizedPhone;
  if (trimmedEmail) person.email = trimmedEmail;

  await pushEvent({
    leadId: lead.id,
    type: "FIELD_CORRECTED",
    actorType: "BORROWER",
    occurredAt: nowIso(),
    payload: {
      source: "post_submit_chat",
      previousPhone,
      newPhone: person.phoneE164,
      previousEmail,
      newEmail: person.email,
    },
  });

  saveDb();
  revalidateLead(publicRef);
  return { ok: true, message: "Thanks — we've updated your contact info." };
}

export async function submitBorrowerMessageAction(publicRef: string, message: string): Promise<ActionResult> {
  const trimmed = message.trim();
  if (!trimmed) return { ok: false, message: "Type a message first." };
  if (trimmed.length > 2000) return { ok: false, message: "That message is too long — keep it under 2000 characters." };

  const lead = await requireLead(publicRef);
  const db = await getDb();

  db.notes.push({
    id: newId("note"),
    leadId: lead.id,
    authorId: "borrower",
    authorName: "Borrower (via status chat)",
    body: trimmed,
    createdAt: nowIso(),
  });

  const taskId = newId("task");
  db.tasks.set(taskId, {
    id: taskId,
    leadId: lead.id,
    type: "BORROWER_MESSAGE",
    dueAt: nowIso(),
    status: "OPEN",
    title: `Borrower message: "${trimmed.length > 80 ? `${trimmed.slice(0, 80)}…` : trimmed}"`,
  });

  await pushEvent({ leadId: lead.id, type: "NOTE_ADDED", actorType: "BORROWER", occurredAt: nowIso(), payload: { source: "post_submit_chat" } });
  const officer = await autoAssignOfficer(db, lead, "borrower_message");

  // Answer immediately when an LLM is configured. The officer task above is
  // filed either way — the AI shortens the wait, it never closes the loop on
  // its own, and anything it shouldn't answer comes back needsHuman=true with
  // a holding reply rather than a guess.
  const person = Array.from(db.people.values()).find((p) => p.leadId === lead.id && p.role === "PRIMARY");
  const answer = await answerBorrowerQuestion({
    question: trimmed,
    firstName: person?.firstName || "there",
    intent: lead.intent,
    goal: lead.goal,
    stateCode: lead.stateCode,
    officerFirstName: officer?.name.split(" ")[0],
    priorContext:
      buildConversationBrief(
        buildLeadThread({
          attempts: db.attempts.filter((a) => a.leadId === lead.id),
          conversations: Array.from(db.conversations.values()).filter((c) => c.leadId === lead.id),
          notes: db.notes.filter((n) => n.leadId === lead.id),
        })
      ) || undefined,
  });

  if (!answer.simulated) {
    // Record the AI's reply so it lands in the unified thread and the officer
    // sees exactly what the borrower was told before they pick this up.
    db.notes.push({
      id: newId("note"),
      leadId: lead.id,
      authorId: "ai-agent",
      authorName: "AI assistant (status chat)",
      body: answer.reply,
      createdAt: nowIso(),
    });
  }

  saveDb();
  revalidateLead(publicRef);
  return { ok: true, message: answer.reply };
}

export interface StatusLookupResult {
  ok: boolean;
  publicRef?: string;
  message: string;
}

// Public, unauthenticated lookup for a borrower who lost their status link.
// Requires phone + last name (not phone alone) so this can't be used to
// enumerate other people's inquiries just by guessing phone numbers.
export async function lookupStatusAction(phone: string, lastName: string): Promise<StatusLookupResult> {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) return { ok: false, message: "Enter a valid 10-digit US phone number." };
  const trimmedLastName = lastName.trim().toLowerCase();
  if (!trimmedLastName) return { ok: false, message: "Enter the last name used on the inquiry." };

  const db = await getDb();
  const match = Array.from(db.people.values())
    .filter((p) => p.role === "PRIMARY" && p.phoneE164 === normalizedPhone && p.lastName.trim().toLowerCase() === trimmedLastName)
    .map((p) => db.leads.get(p.leadId))
    .filter((l): l is Lead => !!l)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

  if (!match) return { ok: false, message: "We couldn't find an inquiry matching that phone number and last name." };
  return { ok: true, publicRef: match.publicRef, message: "Found it." };
}

// ---------------------------------------------------------------------------
// Shared outreach delivery — the guts of "actually place the call / send the
// text / send the email, log the attempt, advance lead state." Used by both
// the borrower-initiated post-submit action below and the automated cadence
// engine (domain/cadenceEngine.ts), so the two never drift out of sync.
// Always goes through PolicyGate first, same as any other attempt.
// ---------------------------------------------------------------------------
export interface DeliverOutreachResult {
  ok: boolean;
  blocked: boolean;
  message: string;
  simulated?: boolean;
  officerFirstName?: string;
}

export async function deliverOutreach(
  db: Database,
  lead: Lead,
  channel: Channel,
  actorType: "BORROWER" | "SYSTEM",
  reason: string
): Promise<DeliverOutreachResult> {
  // The PolicyGate check below reads existing attempts, then (after an
  // await to the outreach provider) writes a new one — a classic
  // check-then-act race if two calls for the same lead overlap (the hourly
  // cadence tick landing mid-way through a borrower's manual click, say).
  // Serializing per lead closes that window; every other lead is unaffected.
  return withLeadLock(lead.id, () => deliverOutreachLocked(db, lead, channel, actorType, reason));
}

async function deliverOutreachLocked(
  db: Database,
  lead: Lead,
  channel: Channel,
  actorType: "BORROWER" | "SYSTEM",
  reason: string
): Promise<DeliverOutreachResult> {
  const person = Array.from(db.people.values()).find((p) => p.leadId === lead.id && p.role === "PRIMARY");

  const decision = await evaluateForLead(lead, channel, false);
  db.policyDecisions.push({
    id: newId("policy"),
    leadId: lead.id,
    channel,
    decision: decision.decision,
    reasons: decision.reasons,
    evaluatedAt: nowIso(),
    nextPermittedAt: decision.nextPermittedAt?.toISOString(),
    inputSnapshot: (await buildGateInput(lead, channel, false)) as unknown as Record<string, unknown>,
  });

  if (decision.decision !== "ALLOW") {
    await pushEvent({ leadId: lead.id, type: "OUTREACH_BLOCKED", actorType, occurredAt: nowIso(), channel, payload: { reasons: decision.reasons, reason } });
    const blockedMessage = decision.reasons.includes("QUIET_HOURS_LOCAL")
      ? `It's outside normal contact hours right now — we'll reach out as soon as they open${decision.nextPermittedAt ? `, around ${decision.nextPermittedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}.`
      : "We couldn't reach you through that channel right now, but a licensed loan officer will still follow up on your timeline.";
    return { ok: false, blocked: true, message: blockedMessage };
  }

  const officer = await autoAssignOfficer(db, lead, reason);
  const officerFirstName = officer?.name.split(" ")[0] ?? "your loan officer";

  // Everything already said to this borrower, on every channel — so the
  // fourth touch doesn't re-introduce us or contradict what they told us on
  // a different channel. See core/conversationThread.ts.
  const priorContext = buildConversationBrief(
    buildLeadThread({
      attempts: db.attempts.filter((a) => a.leadId === lead.id),
      conversations: Array.from(db.conversations.values()).filter((c) => c.leadId === lead.id),
      notes: db.notes.filter((n) => n.leadId === lead.id),
    })
  );

  // VOICE goes through the orchestrator so an automated call is the same
  // conversational agent an officer would get from the Call button — not the
  // one-way announcement this path used to place.
  if (channel === "VOICE") {
    const outcome = await placeOutboundCall(db, lead, person, undefined);

    if (!outcome.ok && outcome.failure) {
      await recordSendFailure(db, lead, person, "VOICE", outcome.failure, undefined);
      lead.updatedAt = nowIso();
      console.error(`[deliverOutreach] VOICE ${outcome.failure.class} failure for lead ${lead.id}: ${outcome.failure.message}`);
      return {
        ok: false,
        blocked: false,
        message: "We tried to reach you but hit a delivery problem — a licensed loan officer will follow up directly.",
        simulated: false,
        officerFirstName,
      };
    }

    lead.attemptsTotal += 1;
    lead.attemptsToday += 1;
    lead.lastAttemptAt = nowIso();
    if (!lead.firstContactAt) lead.firstContactAt = nowIso();
    lead.lastContactAt = nowIso();
    if (lead.state === "NEW") {
      try {
        lead.state = transition(lead.state, "OUTREACH_ATTEMPTED");
      } catch {
        // leave state as-is if not a valid transition from here
      }
    }
    lead.updatedAt = nowIso();

    await pushEvent({
      leadId: lead.id,
      type: "OUTREACH_ATTEMPTED",
      actorType,
      occurredAt: nowIso(),
      channel: "VOICE",
      payload: { simulated: outcome.simulated, reason, mechanism: outcome.strategy.mechanism },
    });

    return {
      ok: true,
      blocked: false,
      message: outcome.simulated ? "Calling you now (simulated)." : "Calling you now.",
      simulated: outcome.simulated,
      officerFirstName,
    };
  }

  const content = await generateOutreachContent({
    channel: "EMAIL",
    firstName: person?.firstName ?? "there",
    intent: lead.intent,
    goal: lead.goal,
    officerFirstName,
    isFirstContact: !lead.firstContactAt,
    priorContext: priorContext || undefined,
  });

  const idempotencyKey = newId("idem");
  let subject: string | undefined;
  let body = content.body;
  let result: AdapterResult;

  if (channel === "SMS") {
    const smsBody = content.body.length > 300 ? content.body.slice(0, 297) + "..." : content.body;
    result = await sendSms({ to: person?.phoneE164 ?? "", body: smsBody, idempotencyKey });
    body = smsBody;
  } else {
    subject = `${officerFirstName} from Equity Flow Group — following up on your inquiry`;
    const statusUrl = `${await getAppUrl()}/status/${lead.publicRef}`;
    const emailBody = `${content.body}\n\nTrack your inquiry anytime: ${statusUrl}`;
    result = await sendEmail({ to: person?.email ?? "", subject, text: emailBody, idempotencyKey, from: `${db.config.senderName} <${db.config.senderEmail}>` });
    body = emailBody;
  }

  const attemptId = newId("attempt");
  const simulated = result.ok ? result.simulated : false;

  // ---- Failure path -------------------------------------------------------
  // A send the provider refused never reached the borrower. It must not
  // consume the attempt budget or advance the cadence, or a provider outage
  // silently burns a lead's entire cadence and drops them into NURTURE having
  // never actually been contacted once.
  if (!result.ok) {
    const priorFailures = db.attempts.filter(
      (a) => a.leadId === lead.id && a.channel === channel && a.outcome === "FAILED"
    ).length;
    const retry = decideRetry(result.failure, priorFailures);

    db.attempts.push({
      id: attemptId,
      leadId: lead.id,
      channel,
      direction: "OUTBOUND",
      idempotencyKey,
      outcome: "FAILED",
      failureClass: result.failure.class,
      failureMessage: result.failure.message,
      retryAfter: retry.retry ? new Date(Date.now() + retry.delayMinutes * 60_000).toISOString() : undefined,
      retryCount: priorFailures,
      attemptNumber: lead.attemptsTotal + 1,
      scheduledFor: nowIso(),
      startedAt: nowIso(),
      subject,
      body,
      aiGenerated: !content.simulated,
    });

    // Note the counters are deliberately NOT incremented before this call,
    // so recordSendFailure has nothing to roll back on the cadence path.
    await recordSendFailure(db, lead, person, channel, result.failure, undefined);
    lead.updatedAt = nowIso();

    console.error(`[deliverOutreach] ${channel} ${result.failure.class} failure for lead ${lead.id}: ${result.failure.message}`);
    return {
      ok: false,
      blocked: false,
      message: "We tried to reach you but hit a delivery problem — a licensed loan officer will follow up directly.",
      simulated: false,
      officerFirstName,
    };
  }

  // ---- Success path -------------------------------------------------------
  db.attempts.push({
    id: attemptId,
    leadId: lead.id,
    channel,
    direction: "OUTBOUND",
    idempotencyKey,
    providerMessageId: result.providerMessageId,
    // SENT means the provider accepted it, not that it arrived. A delivery
    // webhook advances this to DELIVERED or UNDELIVERED once the carrier
    // reports back — see app/api/webhooks/delivery/[provider]/route.ts.
    // Only SMS and EMAIL reach here; VOICE returned via the orchestrator above.
    outcome: "SENT",
    attemptNumber: lead.attemptsTotal + 1,
    scheduledFor: nowIso(),
    startedAt: nowIso(),
    subject,
    body,
    aiGenerated: !content.simulated,
  });

  lead.attemptsTotal += 1;
  lead.attemptsToday += 1;
  lead.lastAttemptAt = nowIso();
  if (!lead.firstContactAt) lead.firstContactAt = nowIso();
  lead.lastContactAt = nowIso();
  if (lead.state === "NEW") {
    try {
      lead.state = transition(lead.state, "OUTREACH_ATTEMPTED");
    } catch {
      // leave state as-is if not a valid transition from here
    }
  }
  lead.updatedAt = nowIso();

  await pushEvent({ leadId: lead.id, type: "OUTREACH_ATTEMPTED", actorType, occurredAt: nowIso(), channel, payload: { simulated, reason } });

  const CHANNEL_MESSAGE: Record<Channel, string> = {
    VOICE: simulated ? "Calling you now (simulated)." : "Calling you now.",
    SMS: simulated ? "Text sent (simulated) — check your messages." : "Text sent — check your messages.",
    EMAIL: simulated ? "Email sent (simulated) — check your inbox." : "Email sent — check your inbox.",
  };
  return { ok: true, blocked: false, message: CHANNEL_MESSAGE[channel], simulated, officerFirstName };
}

// Borrower-initiated first contact, straight from the post-submit screen —
// "click Call me right now and get an instant call from the AI agent."
// Anonymous/public (no officer session): goes through PolicyGate exactly
// like any other attempt, just as an automated (not manual-override) one,
// since this is the lead's very first, borrower-consented contact moment.
export interface BorrowerChannelResult extends ActionResult {
  officerFirstName?: string;
  blocked?: boolean;
}

export async function initiateBorrowerChannelAction(publicRef: string, channel: Channel): Promise<BorrowerChannelResult> {
  const lead = await requireLead(publicRef);
  const db = await getDb();
  const result = await deliverOutreach(db, lead, channel, "BORROWER", `borrower_selected_${channel.toLowerCase()}`);
  saveDb();
  revalidateLead(publicRef);
  return { ok: result.ok, message: result.message, officerFirstName: result.officerFirstName, blocked: result.blocked };
}

// ---------------------------------------------------------------------------
// Referral partners — a lead that can't qualify for refi/equity still
// qualifies for another part of the mortgage industry (loan modification,
// foreclosure assistance, bankruptcy). Referring it out is a second revenue
// line off the same lead spend, not a dead end.
// ---------------------------------------------------------------------------
export interface CreateReferralPartnerInput {
  name: string;
  specialty: ReferralSpecialty;
  contactName?: string;
  phone?: string;
  email?: string;
  notes?: string;
}

export async function createReferralPartnerAction(input: CreateReferralPartnerInput): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (user.role !== "ADMIN") {
    return { ok: false, message: "Only Admin can add referral partners." };
  }
  if (!input.name.trim()) return { ok: false, message: "Partner name is required." };

  const db = await getDb();
  const id = newId("partner");
  db.referralPartners.set(id, {
    id,
    name: input.name.trim(),
    specialty: input.specialty,
    contactName: input.contactName?.trim() || undefined,
    phone: input.phone?.trim() || undefined,
    email: input.email?.trim() || undefined,
    notes: input.notes?.trim() || undefined,
    isActive: true,
    createdAt: nowIso(),
  });
  await audit(user.id, user.name, "CREATE_REFERRAL_PARTNER", "ReferralPartner", id, "ALLOW");
  saveDb();
  revalidatePath("/workspace/admin");
  return { ok: true, message: `${input.name} added to referral partners.` };
}

export async function setReferralPartnerActiveAction(partnerId: string, isActive: boolean): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (user.role !== "ADMIN") {
    return { ok: false, message: "Only Admin can change referral partners." };
  }
  const db = await getDb();
  const partner = db.referralPartners.get(partnerId);
  if (!partner) return { ok: false, message: "Referral partner not found." };
  partner.isActive = isActive;
  await audit(user.id, user.name, isActive ? "REACTIVATE_REFERRAL_PARTNER" : "DEACTIVATE_REFERRAL_PARTNER", "ReferralPartner", partnerId, "ALLOW");
  saveDb();
  revalidatePath("/workspace/admin");
  return { ok: true, message: `${partner.name} ${isActive ? "reactivated" : "deactivated"}.` };
}

export async function referLeadToPartnerAction(publicRef: string, partnerId: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  const lead = await requireLead(publicRef);
  if (!can({ role: user.role, officerId: user.officerId }, "CALL_NOW", lead)) {
    return { ok: false, message: "You don't have permission to refer this lead." };
  }
  const db = await getDb();
  const partner = db.referralPartners.get(partnerId);
  if (!partner) return { ok: false, message: "Referral partner not found." };

  lead.referredToPartnerId = partnerId;
  lead.referredAt = nowIso();
  lead.updatedAt = nowIso();

  await pushEvent({
    leadId: lead.id,
    type: "NOTE_ADDED",
    actorType: "OFFICER",
    actorId: user.id,
    actorName: user.name,
    occurredAt: nowIso(),
    payload: { note: `Referred to ${partner.name} (${partner.specialty.replace("_", " ").toLowerCase()})` },
  });
  db.notes.push({
    id: newId("note"),
    leadId: lead.id,
    authorId: user.id,
    authorName: user.name,
    body: `Referred to ${partner.name} — ${partner.specialty.replace("_", " ").toLowerCase()} specialist.`,
    createdAt: nowIso(),
  });
  await audit(user.id, user.name, "REFER_LEAD_TO_PARTNER", "Lead", lead.id, "ALLOW");
  saveDb();
  revalidateLead(publicRef);
  return { ok: true, message: `Referred to ${partner.name}.` };
}
