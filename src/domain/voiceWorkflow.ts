import { maskPhone } from "@/core/rbac";
import {
  QUALIFICATION_QUESTIONS,
  QUALIFICATION_PLAN_VERSION,
  buildQualificationQuestionPlan,
  computeCallContextCompleteness,
  decideQualification,
  nextQualificationQuestion,
  normalizeQualificationAnswer,
  qualificationPlanItem,
  seedAnswersFromSnapshot,
} from "@/core/qualification";
import { generateCallbackSlots } from "@/core/callbackScheduling";
import { buildBriefForLead } from "@/domain/leadContext";
import { ensureCallbackOutboxJobs } from "@/domain/callbackOutbox";
import { getDb, newId, nowIso, saveDb, type Database } from "@/domain/store";
import { isValidIanaTimezone } from "@/core/timezone";
import { normalizePhone } from "@/core/intakeNormalization";
import { redactRestrictedText } from "@/core/sensitiveText";
import type {
  CallbackAppointment,
  Lead,
  LeadContextSnapshot,
  Person,
  QualificationAnswer,
  QualificationProgress,
  QualificationQuestionId,
  TransferAttempt,
} from "@/domain/types";

// Kept local to this module so a context snapshot can never accidentally grow
// to include restricted credit or identity data when Lead gains new fields.
const EXCLUDED_SENSITIVE_FIELDS = ["ssn", "dateOfBirth", "bankAccount", "creditReport", "creditScore"];

export function buildLeadContextSnapshot(input: {
  db: Database; lead: Lead; person: Person | undefined; conversationId: string; promptVersionId: string; profileVersionId: string;
}): LeadContextSnapshot {
  const verifiedFields: Record<string, unknown> = {};
  const fieldEvidence: LeadContextSnapshot["fieldEvidence"] = {};
  for (const field of input.db.leadFields.values()) {
    if (field.leadId !== input.lead.id || EXCLUDED_SENSITIVE_FIELDS.some((key) => field.fieldPath.toLowerCase().includes(key.toLowerCase()))) continue;
    fieldEvidence[field.fieldPath] = {
      sourceType: field.sourceType,
      verificationStatus: field.verificationStatus,
      confidence: field.confidence,
      collectedAt: field.collectedAt,
    };
    if (field.verificationStatus === "VERIFIED") verifiedFields[field.fieldPath] = field.value;
  }
  const valuation = input.lead.propertyValuation;
  const snapshot: LeadContextSnapshot = {
    id: newId("ctx"), leadId: input.lead.id, conversationId: input.conversationId, createdAt: nowIso(),
    contextVersion: "call_context_v2", questionPlanVersion: QUALIFICATION_PLAN_VERSION, completenessPercentage: 0,
    promptVersionId: input.promptVersionId, profileVersionId: input.profileVersionId,
    borrower: {
      firstName: input.person?.firstName ?? "there",
      timezone: input.person?.timezone ?? "UNKNOWN",
      preferredContactWindow: input.person?.preferredContactWindow,
      dataQualityFlags: input.person?.dataQualityFlags,
    },
    intake: {
      submittedAt: input.lead.createdAt,
      intent: input.lead.intent, goal: input.lead.goal, timeline: input.lead.timeline, stateCode: input.lead.stateCode,
      occupancy: input.lead.occupancy, addressLine1: input.lead.addressLine1, city: input.lead.city,
      postalCode: input.lead.postalCode, estimatedValue: input.lead.estimatedValue,
      currentBalance: input.lead.currentBalance, creditRange: input.lead.creditRange,
      missedPayments: input.lead.missedPayments, referralType: input.lead.referralType,
      hasExistingHomeEquityLoan: input.lead.hasExistingHomeEquityLoan,
    },
    verifiedFields, fieldEvidence,
    propertyEnrichment: valuation ? {
      estimatedValue: valuation.estimatedValue,
      estimatedMortgageBalance: valuation.estimatedMortgageBalance,
      estimatedLTV: valuation.estimatedLTV,
      usableEquity: valuation.usableEquity,
      method: valuation.method,
      confidence: valuation.confidence,
      simulated: valuation.simulated,
    } : undefined,
    conversationBrief: redactRestrictedText(buildBriefForLead(input.db, input.lead)).text || undefined,
    excludedSensitiveFields: [...EXCLUDED_SENSITIVE_FIELDS],
  };
  snapshot.completenessPercentage = computeCallContextCompleteness(snapshot);
  return snapshot;
}

export function initializeQualification(db: Database, snapshot: LeadContextSnapshot) {
  const now = nowIso();
  const questionPlan = buildQualificationQuestionPlan(snapshot);
  const progress: QualificationProgress = {
    leadId: snapshot.leadId,
    conversationId: snapshot.conversationId,
    snapshotId: snapshot.id,
    answers: seedAnswersFromSnapshot(snapshot, now),
    requiredQuestionIds: questionPlan.map((item) => item.questionId),
    questionPlanVersion: QUALIFICATION_PLAN_VERSION,
    questionPlan,
    updatedAt: now,
  };
  progress.nextQuestionId = nextQualificationQuestion(progress)?.id;
  db.leadContextSnapshots.set(snapshot.id, snapshot);
  db.qualificationProgress.set(snapshot.conversationId, progress);
  return progress;
}

function spokenKnownValue(questionId: QualificationQuestionId, value: unknown): string {
  if ((questionId === "estimated_value" || questionId === "mortgage_balance") && typeof value === "number") {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
  }
  const labels: Record<string, string> = {
    ASAP: "as soon as possible", "1_3_MONTHS": "one to three months", "3_6_MONTHS": "three to six months",
    EXPLORING: "still exploring", PRIMARY: "your primary home", SECOND_HOME: "a second home", INVESTMENT: "an investment property",
    EXCELLENT_740_PLUS: "740 or higher", GOOD_680_739: "680 to 739", FAIR_620_679: "620 to 679", BELOW_620: "below 620",
    LOWER_PAYMENT: "lowering the monthly payment", CASH_OUT: "accessing funds", SHORTEN_TERM: "shortening the loan term", OTHER: "another goal",
  };
  return labels[String(value)] ?? String(value).replaceAll("_", " ").toLowerCase();
}

function confirmationPrompt(questionId: QualificationQuestionId, value: unknown): string {
  const spoken = spokenKnownValue(questionId, value);
  const leadIn: Record<QualificationQuestionId, string> = {
    timeline: `You previously said your timing was ${spoken}`,
    property_address: `I have the property address as ${spoken}`,
    foreclosure_status: `I have your foreclosure status as ${spoken}`,
    occupancy: `I have this listed as ${spoken}`,
    estimated_value: `I have your estimated property value as about ${spoken}`,
    mortgage_balance: `I have the current mortgage balance as about ${spoken}`,
    cash_goal: `I have your main goal as ${spoken}`,
    credit_range: `I have your broad credit range as ${spoken}`,
    transfer_consent: `I have your transfer preference as ${spoken}`,
  };
  return `${leadIn[questionId]}. Is that still correct?`;
}

export function getNextQuestion(db: Database, conversationId: string) {
  const progress = db.qualificationProgress.get(conversationId);
  if (!progress) throw new Error("Qualification session was not initialized.");
  const question = nextQualificationQuestion(progress);
  progress.nextQuestionId = question?.id;
  progress.updatedAt = nowIso();
  if (!question) progress.completedAt ??= nowIso();
  if (!question) return { complete: true, decision: db.qualificationDecisions.get(conversationId) };

  // The newest form/verified value is supplied only to phrase a confirmation.
  // It never marks the question complete; the borrower still has to confirm or
  // correct it and record_qualification_answer must accept that exact turn.
  const planItem = qualificationPlanItem(progress, question.id);
  const known = [...progress.answers]
    .reverse()
    .find((answer) => answer.questionId === question.id && answer.source !== "BORROWER_STATED" && !answer.conflict);
  const knownValue = known?.value;
  const prompt = known
    ? confirmationPrompt(question.id, knownValue)
    : question.prompt;
  return {
    complete: false,
    question: { ...question, prompt, mode: planItem.mode, reason: planItem.reason },
    knownAnswer: known ? { value: knownValue, source: known.source } : undefined,
    instruction: "Ask exactly this one question. Do not combine it with another question. Record only the borrower's explicit confirmation or correction.",
  };
}

export function recordQualificationAnswer(db: Database, input: {
  conversationId: string; questionId: QualificationQuestionId; value: unknown; confidence?: number; transcriptTurnRefs?: number[]; idempotencyKey?: string;
}) {
  const progress = db.qualificationProgress.get(input.conversationId);
  if (!progress) throw new Error("Qualification session was not initialized.");
  const lead = db.leads.get(progress.leadId);
  if (!lead) throw new Error("Lead was not found.");
  const existingAnswer = input.idempotencyKey
    ? progress.answers.find((item) => item.id === `qa_${input.idempotencyKey}`)
    : undefined;
  if (existingAnswer) {
    return { answer: existingAnswer, nextQuestion: nextQualificationQuestion(progress), decision: db.qualificationDecisions.get(input.conversationId) };
  }
  const expectedQuestion = nextQualificationQuestion(progress);
  if (!expectedQuestion || expectedQuestion.id !== input.questionId) {
    throw new Error(
      expectedQuestion
        ? `Out-of-sequence answer rejected. Ask ${expectedQuestion.id} next.`
        : "The required qualification sequence is already complete."
    );
  }
  const question = QUALIFICATION_QUESTIONS[input.questionId];
  const value = normalizeQualificationAnswer(input.questionId, input.value);
  const existingAuthoritative = db.leadFields.get(`${lead.id}:${question.fieldPath}`);
  const conflict = Boolean(existingAuthoritative?.verificationStatus === "VERIFIED" && JSON.stringify(existingAuthoritative.value) !== JSON.stringify(value));
  const answer: QualificationAnswer = {
    id: input.idempotencyKey ? `qa_${input.idempotencyKey}` : newId("qa"), leadId: lead.id, conversationId: input.conversationId, questionId: input.questionId,
    fieldPath: question.fieldPath, value, confidence: Math.min(1, Math.max(0, input.confidence ?? 0.9)),
    source: "BORROWER_STATED", transcriptTurnRefs: input.transcriptTurnRefs ?? [], conflict, capturedAt: nowIso(),
  };
  progress.answers = progress.answers.filter((item) => item.questionId !== input.questionId || item.source !== "BORROWER_STATED");
  progress.answers.push(answer);
  progress.updatedAt = nowIso();
  progress.nextQuestionId = nextQualificationQuestion(progress)?.id;
  db.fieldCandidates.push({
    id: newId("candidate"), leadId: lead.id, fieldPath: question.fieldPath, value, confidence: answer.confidence,
    sourceType: "BORROWER_STATED", sessionId: input.conversationId, transcriptTurnRefs: answer.transcriptTurnRefs,
    createdAt: answer.capturedAt, promoted: false, reviewStatus: "PENDING",
  });
  const decision = decideQualification(progress, lead.referralType, nowIso());
  db.qualificationDecisions.set(input.conversationId, decision);
  return { answer, nextQuestion: nextQualificationQuestion(progress), decision };
}

export function resolveTransferDestination(db: Database, lead: Lead, fallbackNumber?: string): { officerId?: string; phone: string } | undefined {
  const assigned = lead.assignedOfficerId ? db.officers.get(lead.assignedOfficerId) : undefined;
  const assignedPhone = assigned?.phone ? normalizePhone(assigned.phone) : null;
  if (assigned?.isActive && assignedPhone && assigned.licensedStates.includes(lead.stateCode)) return { officerId: assigned.id, phone: assignedPhone };
  const eligible = Array.from(db.officers.values()).find((officer) => officer.isActive && officer.phone && officer.licensedStates.includes(lead.stateCode) && officer.productTypes.includes(lead.intent));
  const eligiblePhone = eligible?.phone ? normalizePhone(eligible.phone) : null;
  if (eligiblePhone) return { officerId: eligible!.id, phone: eligiblePhone };
  const central = fallbackNumber?.trim() || process.env.WARM_TRANSFER_FALLBACK_NUMBER?.trim();
  const centralPhone = central ? normalizePhone(central) : null;
  return centralPhone ? { phone: centralPhone } : undefined;
}

export function createTransferAttempt(db: Database, conversationId: string, consentTurnRef?: number, idempotencyKey?: string, fallbackNumber?: string): TransferAttempt {
  const progress = db.qualificationProgress.get(conversationId);
  if (!progress) throw new Error("Qualification session was not initialized.");
  const lead = db.leads.get(progress.leadId);
  if (!lead) throw new Error("Lead was not found.");
  const existing = idempotencyKey
    ? Array.from(db.transferAttempts.values()).find((item) => item.providerTransferId === idempotencyKey)
    : undefined;
  if (existing) return existing;
  const decision = decideQualification(progress, lead.referralType, nowIso());
  db.qualificationDecisions.set(conversationId, decision);
  if (decision.outcome !== "READY_FOR_TRANSFER") throw new Error("The deterministic qualification gate has not cleared this call for transfer.");
  const destination = resolveTransferDestination(db, lead, fallbackNumber);
  if (!destination) throw new Error("No licensed transfer destination is available; offer a callback.");
  const transfer: TransferAttempt = {
    id: newId("transfer"), leadId: lead.id, conversationId, officerId: destination.officerId,
    destinationMasked: maskPhone(destination.phone), status: "REQUESTED", requestedAt: nowIso(), updatedAt: nowIso(), consentTurnRef,
    providerTransferId: idempotencyKey,
  };
  db.transferAttempts.set(transfer.id, transfer);
  db.events.push({
    id: newId("evt"), leadId: lead.id, type: "TRANSFER_STATUS_CHANGED", actorType: "SYSTEM",
    payload: { transferAttemptId: transfer.id, status: transfer.status, conversationId },
    occurredAt: nowIso(), recordedAt: nowIso(), correlationId: newId("corr"),
  });
  return transfer;
}

export function getCallbackSlotsForConversation(db: Database, conversationId: string, borrowerTimezone?: string) {
  const progress = db.qualificationProgress.get(conversationId);
  if (!progress) throw new Error("Qualification session was not initialized.");
  const lead = db.leads.get(progress.leadId);
  if (!lead) throw new Error("Lead was not found.");
  const person = Array.from(db.people.values()).find((item) => item.leadId === lead.id && item.role === "PRIMARY");
  const officer = (lead.assignedOfficerId && db.officers.get(lead.assignedOfficerId)) || Array.from(db.officers.values()).find((item) => item.isActive && item.licensedStates.includes(lead.stateCode));
  if (!officer) return [];
  return generateCallbackSlots({
    now: new Date(), adminTimezone: db.config.adminTimezone ?? "America/Los_Angeles",
    borrowerTimezone: borrowerTimezone || person?.timezone || db.config.adminTimezone || "America/Los_Angeles",
    officer, policy: db.config.callbackReminderPolicy!, appointments: Array.from(db.callbackAppointments.values()),
  });
}

export async function bookCallbackForConversation(input: { conversationId: string; startsAt: string; borrowerTimezone: string; idempotencyKey?: string }): Promise<CallbackAppointment> {
  const db = await getDb();
  if (!isValidIanaTimezone(input.borrowerTimezone)) throw new Error("Choose a valid IANA borrower timezone.");
  const progress = db.qualificationProgress.get(input.conversationId);
  if (!progress) throw new Error("Qualification session was not initialized.");
  const lead = db.leads.get(progress.leadId);
  if (!lead) throw new Error("Lead was not found.");
  const existing = input.idempotencyKey
    ? Array.from(db.callbackAppointments.values()).find((item) => item.providerCorrelationIds.includes(input.idempotencyKey!))
    : undefined;
  if (existing) return existing;
  const slots = getCallbackSlotsForConversation(db, input.conversationId, input.borrowerTimezone);
  const chosen = slots.find((slot) => slot.startsAt === new Date(input.startsAt).toISOString());
  if (!chosen) throw new Error("That callback slot is no longer available.");
  const now = nowIso();
  const consent = db.consents.filter((item) => item.leadId === lead.id && item.scope === "CONTACT_SMS" && item.granted).sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))[0];
  const transfer = Array.from(db.transferAttempts.values()).filter((item) => item.conversationId === input.conversationId).sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))[0];
  const appointment: CallbackAppointment = {
    id: newId("callback"), leadId: lead.id, officerId: chosen.officerId, sourceConversationId: input.conversationId,
    transferAttemptId: transfer?.id,
    startsAt: chosen.startsAt, endsAt: chosen.endsAt, borrowerTimezone: input.borrowerTimezone,
    status: "BOOKED", consentRecordId: consent?.id, createdAt: now, updatedAt: now, providerCorrelationIds: input.idempotencyKey ? [input.idempotencyKey] : [],
  };
  db.callbackAppointments.set(appointment.id, appointment);
  const appendEvent = (type: "CALLBACK_BOOKED" | "CALLBACK_MESSAGE_QUEUED", payload: Record<string, unknown>) => db.events.push({
    id: newId("evt"), leadId: lead.id, type, actorType: "SYSTEM", payload, occurredAt: nowIso(), recordedAt: nowIso(), correlationId: newId("corr"),
  });
  appendEvent("CALLBACK_BOOKED", { appointmentId: appointment.id, startsAt: appointment.startsAt, borrowerTimezone: appointment.borrowerTimezone });
  // The booking is authoritative before any delivery job becomes visible.
  // If queueing fails, reconciliation can repair the durable appointment;
  // the reverse ordering could text about a booking that never committed.
  await saveDb();
  await ensureCallbackOutboxJobs(db, appointment);
  await saveDb();
  return appointment;
}
