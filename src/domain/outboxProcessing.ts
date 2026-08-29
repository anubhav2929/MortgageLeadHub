import { sendEmail } from "@/adapters/email";
import { sendSms } from "@/adapters/sms";
import { evaluateForLead } from "@/domain/gateHelpers";
import { claimOutboxBatch, settleOutbox, type OutboxJob } from "@/domain/durableQueue";
import { getDb, newId, nowIso, refreshDb, saveDb } from "@/domain/store";
import { callbackMessageEligibility } from "@/core/callbackReminder";
import { reconcileCallbackOutbox } from "@/domain/callbackOutbox";

interface CallbackSmsPayload { appointmentId: string; body: string }
interface InquiryEmailPayload { leadId: string; subject: string; body: string }

function appendTimeline(db: Awaited<ReturnType<typeof getDb>>, leadId: string, type: "CALLBACK_MESSAGE_SENT" | "CALLBACK_MESSAGE_SUPPRESSED", payload: Record<string, unknown>) {
  db.events.push({ id: newId("evt"), leadId, type, actorType: "SYSTEM", payload, occurredAt: nowIso(), recordedAt: nowIso(), correlationId: newId("corr") });
}

async function suppressCallbackJob(job: OutboxJob, appointmentId: string, leadId: string, body: string, reason: string) {
  const db = await getDb();
  if (!db.attempts.some((item) => item.idempotencyKey === job.idempotencyKey)) {
    db.attempts.push({
      id: newId("attempt"), leadId, channel: "SMS", direction: "OUTBOUND", idempotencyKey: job.idempotencyKey,
      outcome: "BLOCKED", blockedReason: reason, attemptNumber: (db.leads.get(leadId)?.attemptsTotal ?? 0) + 1,
      scheduledFor: nowIso(), body, loggedById: "system", loggedByName: "Callback scheduler",
    });
    appendTimeline(db, leadId, "CALLBACK_MESSAGE_SUPPRESSED", { appointmentId, kind: job.jobType, reason });
    await saveDb();
  }
}

async function processCallbackSms(job: OutboxJob): Promise<void> {
  const payload = job.payload as CallbackSmsPayload;
  const db = await refreshDb();
  const appointment = db.callbackAppointments.get(payload.appointmentId);
  if (!appointment) throw new Error("Callback appointment is missing");
  const isReminder = job.jobType === "CALLBACK_SMS_REMINDER";
  const eligibility = callbackMessageEligibility(appointment, isReminder ? "reminder" : "confirmation");
  if (!eligibility.allowed) {
    await suppressCallbackJob(job, appointment.id, appointment.leadId, payload.body, eligibility.reason);
    return;
  }
  const lead = db.leads.get(appointment.leadId);
  if (!lead) throw new Error("Callback lead is missing");
  const person = Array.from(db.people.values()).find((item) => item.leadId === lead.id && item.role === "PRIMARY");
  if (!person?.phoneE164) throw new Error("Callback borrower phone is missing");

  const decision = await evaluateForLead(lead, "SMS", false);
  if (decision.decision === "DEFER") {
    const error = new Error("POLICY_DEFER");
    Object.assign(error, { retryAt: decision.nextPermittedAt?.toISOString() });
    throw error;
  }
  if (decision.decision === "DENY") {
    await suppressCallbackJob(job, appointment.id, appointment.leadId, payload.body, decision.reasons.join(", "));
    return;
  }

  const result = await sendSms({
    to: person.phoneE164,
    body: payload.body,
    idempotencyKey: job.idempotencyKey,
    requireIdempotentProvider: true,
  });
  const existingAttempt = db.attempts.find((item) => item.idempotencyKey === job.idempotencyKey);
  const attemptId = existingAttempt?.id ?? newId("attempt");
  const attempt = existingAttempt ?? {
    id: attemptId, leadId: lead.id, channel: "SMS" as const, direction: "OUTBOUND" as const, idempotencyKey: job.idempotencyKey,
    outcome: "QUEUED" as const, attemptNumber: lead.attemptsTotal + 1, scheduledFor: nowIso(), body: payload.body,
    loggedById: "system", loggedByName: "Callback scheduler",
  };
  Object.assign(attempt, {
    providerMessageId: result.ok ? result.providerMessageId : undefined, outcome: result.ok ? "SENT" : "FAILED",
    failureClass: result.ok ? undefined : result.failure.class, failureMessage: result.ok ? undefined : result.failure.message,
    startedAt: nowIso(),
  });
  if (!existingAttempt) db.attempts.push(attempt);
  if (!result.ok) {
    await saveDb();
    throw new Error(result.failure.message);
  }
  lead.attemptsTotal += 1;
  lead.lastAttemptAt = nowIso();
  lead.updatedAt = nowIso();
  if (isReminder) appointment.reminderAttemptId = attemptId;
  else {
    appointment.confirmationAttemptId = attemptId;
    appointment.status = "CONFIRMED";
  }
  appointment.providerCorrelationIds.push(result.providerMessageId);
  appointment.updatedAt = nowIso();
  appendTimeline(db, lead.id, "CALLBACK_MESSAGE_SENT", { appointmentId: appointment.id, kind: isReminder ? "reminder" : "confirmation", attemptId });
  await saveDb();
}

async function processInquiryEmail(job: OutboxJob): Promise<void> {
  const payload = job.payload as InquiryEmailPayload;
  const db = await getDb();
  const lead = db.leads.get(payload.leadId);
  if (!lead) throw new Error("Inquiry lead is missing");
  const person = Array.from(db.people.values()).find((item) => item.leadId === lead.id && item.role === "PRIMARY");
  if (!person?.email) return;
  const decision = await evaluateForLead(lead, "EMAIL", false);
  if (decision.decision !== "ALLOW") return;
  const result = await sendEmail({
    to: person.email, subject: payload.subject, text: payload.body, idempotencyKey: job.idempotencyKey,
    from: `${db.config.senderName} <${db.config.senderEmail}>`,
    leadPublicRef: lead.publicRef,
  });
  const existingAttempt = db.attempts.find((item) => item.idempotencyKey === job.idempotencyKey);
  const attemptId = existingAttempt?.id ?? newId("attempt");
  const attempt = existingAttempt ?? {
    id: attemptId, leadId: lead.id, channel: "EMAIL" as const, direction: "OUTBOUND" as const, idempotencyKey: job.idempotencyKey,
    outcome: "QUEUED" as const, attemptNumber: lead.attemptsTotal + 1, scheduledFor: nowIso(), subject: payload.subject,
    body: payload.body, loggedById: "system", loggedByName: "Inquiry confirmation",
  };
  Object.assign(attempt, {
    providerMessageId: result.ok ? result.providerMessageId : undefined, outcome: result.ok ? "SENT" : "FAILED",
    failureClass: result.ok ? undefined : result.failure.class, failureMessage: result.ok ? undefined : result.failure.message,
    startedAt: nowIso(),
  });
  if (!existingAttempt) db.attempts.push(attempt);
  if (!result.ok) {
    await saveDb();
    throw new Error(result.failure.message);
  }
  lead.attemptsTotal += 1;
  lead.lastAttemptAt = nowIso();
  lead.updatedAt = nowIso();
  await saveDb();
}

async function processOutboxJob(job: OutboxJob): Promise<void> {
  if (job.jobType === "CALLBACK_SMS_CONFIRMATION" || job.jobType === "CALLBACK_SMS_REMINDER") return processCallbackSms(job);
  if (job.jobType === "INQUIRY_CONFIRMATION_EMAIL") return processInquiryEmail(job);
  throw new Error(`Unsupported outbox job type: ${job.jobType}`);
}

export async function processOutboxBatch(limit = 50) {
  await reconcileCallbackOutbox();
  const claimed = await claimOutboxBatch(limit);
  let completed = 0;
  let retried = 0;
  let dead = 0;
  for (const job of claimed) {
    try {
      await processOutboxJob(job);
      await settleOutbox(job.id, "COMPLETED");
      completed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Outbox job failed";
      const retryAt = error && typeof error === "object" && "retryAt" in error ? String((error as { retryAt?: string }).retryAt ?? "") : undefined;
      const terminal = job.attemptCount >= 5 || /missing|unsupported/i.test(message);
      await settleOutbox(job.id, terminal ? "DEAD" : "RETRY", message, retryAt || new Date(Date.now() + Math.min(60, 2 ** job.attemptCount) * 60_000).toISOString());
      if (terminal) dead += 1;
      else retried += 1;
    }
  }
  return { claimed: claimed.length, completed, retried, dead };
}
