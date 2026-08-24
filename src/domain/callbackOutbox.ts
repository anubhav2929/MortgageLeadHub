import { renderCallbackTemplate } from "@/core/callbackScheduling";
import { enqueueOutboxBatch } from "@/domain/durableQueue";
import { refreshDb, newId, nowIso, saveDb, type Database } from "@/domain/store";
import type { CallbackAppointment } from "@/domain/types";

export async function ensureCallbackOutboxJobs(db: Database, appointment: CallbackAppointment): Promise<boolean> {
  if (appointment.status === "CANCELLED" || appointment.status === "COMPLETED" || appointment.status === "MISSED") return false;
  const policy = db.config.callbackReminderPolicy!;
  const reminderAt = new Date(new Date(appointment.startsAt).getTime() - policy.reminderMinutesBefore * 60_000).toISOString();
  const results = await enqueueOutboxBatch([
    {
      jobType: "CALLBACK_SMS_CONFIRMATION",
      idempotencyKey: `callback:${appointment.id}:confirmation`,
      aggregateType: "CallbackAppointment",
      aggregateId: appointment.id,
      payload: { appointmentId: appointment.id, body: renderCallbackTemplate(policy.confirmationTemplate, appointment.startsAt, appointment.borrowerTimezone) },
    },
    {
      jobType: "CALLBACK_SMS_REMINDER",
      idempotencyKey: `callback:${appointment.id}:reminder`,
      aggregateType: "CallbackAppointment",
      aggregateId: appointment.id,
      payload: { appointmentId: appointment.id, body: renderCallbackTemplate(policy.reminderTemplate, appointment.startsAt, appointment.borrowerTimezone) },
      nextAttemptAt: reminderAt,
    },
  ]);
  const kinds = ["confirmation", "reminder"] as const;
  let changed = false;
  results.forEach((result, index) => {
    if (result.duplicate) return;
    changed = true;
    db.events.push({
      id: newId("evt"), leadId: appointment.leadId, type: "CALLBACK_MESSAGE_QUEUED", actorType: "SYSTEM",
      payload: { appointmentId: appointment.id, kind: kinds[index], ...(index === 1 ? { scheduledFor: reminderAt } : {}) },
      occurredAt: nowIso(), recordedAt: nowIso(), correlationId: newId("corr"),
    });
  });
  return changed;
}

/** Repairs the only possible split transaction: an appointment snapshot may
 * commit before its SQL outbox rows. Idempotent keys make this safe on every
 * worker pass and ensure both callback jobs are recreated together. */
export async function reconcileCallbackOutbox(): Promise<number> {
  const db = await refreshDb();
  let repaired = 0;
  for (const appointment of db.callbackAppointments.values()) {
    if (await ensureCallbackOutboxJobs(db, appointment)) repaired += 1;
  }
  if (repaired > 0) await saveDb();
  return repaired;
}
