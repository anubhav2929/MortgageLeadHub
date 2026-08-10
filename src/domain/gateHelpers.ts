import { evaluatePolicyGate, type GateInput } from "@/core/policyGate";
import { getDb } from "@/domain/store";
import type { Channel, Lead } from "@/domain/types";

export async function buildGateInput(lead: Lead, channel: Channel, isManualOfficerAction = false): Promise<GateInput> {
  const db = await getDb();
  const person = Array.from(db.people.values()).find((p) => p.leadId === lead.id && p.role === "PRIMARY");
  const suppression = person ? db.suppressions.get(person.phoneE164) : undefined;
  const consents = db.consents
    .filter((c) => c.leadId === lead.id)
    .sort((a, b) => new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime());

  const latestByScope = new Map<string, { scope: typeof consents[number]["scope"]; granted: boolean }>();
  for (const c of consents) latestByScope.set(c.scope, { scope: c.scope, granted: c.granted });

  const cadencePlan = db.cadencePlans.get(lead.cadencePlanVersionId);
  // A cadence plan can (and typically does) schedule the same channel more
  // than once — e.g. cadence_default fires VOICE at 0/1440/4320 minutes. The
  // cap for this channel is the plan's TOTAL intended attempts on it, not
  // just whichever step happens to match first — using only the first
  // match's maxAttempts (1) would block every later step on that channel
  // after the very first attempt, permanently stalling the cadence engine.
  const stepsForChannel = cadencePlan?.steps.filter((s) => s.channel === channel) ?? [];
  const step = stepsForChannel[0] ?? { channel, maxAttempts: 3, offsetMinutes: 0, stopOnOutcomes: [] };
  const planMaxAttemptsForChannel = stepsForChannel.length > 0 ? stepsForChannel.reduce((sum, s) => sum + s.maxAttempts, 0) : step.maxAttempts;

  // The attempt cap and spacing rules are per cadence step, i.e. per channel —
  // a lead that's used up its one allowed VOICE attempt should still be
  // textable/emailable, and a voice call shouldn't put SMS into a 4h cooldown.
  // Count/track attempts on THIS channel only, not the lead's global counters.
  const channelAttemptRecords = db.attempts
    .filter((a) => a.leadId === lead.id && a.channel === channel && a.outcome !== "BLOCKED")
    .sort((a, b) => new Date(b.scheduledFor).getTime() - new Date(a.scheduledFor).getTime());
  const today = new Date().toDateString();
  const channelAttemptsToday = channelAttemptRecords.filter((a) => new Date(a.scheduledFor).toDateString() === today).length;
  const channelLastAttemptAt = channelAttemptRecords[0] ? new Date(channelAttemptRecords[0].scheduledFor) : null;

  // A licensed officer manually deciding to reach out again is a deliberate
  // human decision, not the automated retry loop the cadence cap exists to
  // prevent — give manual actions materially more headroom than the
  // single-shot automated cadence step.
  const maxAttempts = isManualOfficerAction ? Math.max(planMaxAttemptsForChannel, 10) : planMaxAttemptsForChannel;

  return {
    now: new Date(),
    channel,
    phoneE164: person?.phoneE164 ?? "",
    personTimezone: person?.timezone ?? "UNKNOWN",
    propertyStateCode: lead.stateCode,
    consents: Array.from(latestByScope.values()),
    suppressions: suppression
      ? [{ scope: suppression.scope, channel: suppression.channel, expiresAt: suppression.expiresAt }]
      : [],
    attemptsToday: channelAttemptsToday,
    attemptsTotal: channelAttemptRecords.length,
    lastAttemptAt: channelLastAttemptAt,
    leadState: lead.state,
    killSwitchOn: db.killSwitch.isOn,
    cadenceStep: { maxAttempts, channel },
    isManualOfficerAction,
    config: {
      dailyAttemptCap: db.config.dailyAttemptCap,
      minSpacingHours: db.config.minSpacingHours,
      quietHoursStart: db.config.quietHoursStart,
      quietHoursEnd: db.config.quietHoursEnd,
    },
    // PolicyGate itself discards these unless isManualOfficerAction is true,
    // so passing them unconditionally is safe — automation can't inherit them.
    overrides: db.config.outreachOverrides,
  };
}

export async function evaluateForLead(lead: Lead, channel: Channel, isManualOfficerAction = false) {
  return evaluatePolicyGate(await buildGateInput(lead, channel, isManualOfficerAction));
}
