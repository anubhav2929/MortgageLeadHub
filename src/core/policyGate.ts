// PolicyGate — the compliance core. SPEC.md section 6.
// Pure function: no I/O, no imports from adapters/db/next. Same contract
// this would have inside packages/core if/when this moves to a real monorepo.

import type { Channel, ConsentScope, LeadState, RuleCode } from "@/domain/types";

export interface ConsentSnapshot {
  scope: ConsentScope;
  granted: boolean;
}

export interface SuppressionSnapshot {
  scope: "GLOBAL" | "CHANNEL";
  channel?: Channel;
  expiresAt?: string | null;
}

export interface CadenceStepInput {
  maxAttempts: number;
  channel: Channel;
}

export interface GateInput {
  now: Date;
  channel: Channel;
  phoneE164: string;
  personTimezone: string | "UNKNOWN";
  propertyStateCode: string | null;
  consents: ConsentSnapshot[];
  suppressions: SuppressionSnapshot[];
  attemptsToday: number;
  attemptsTotal: number;
  lastAttemptAt: Date | null;
  leadState: LeadState;
  killSwitchOn: boolean;
  cadenceStep: CadenceStepInput;
  /** true when a licensed officer is manually initiating contact, not an automated cadence step */
  isManualOfficerAction?: boolean;
  /** Admin-configurable — see Admin > Settings. Falls back to spec defaults when omitted. */
  config?: {
    dailyAttemptCap?: number;
    minSpacingHours?: number;
    quietHoursStart?: number;
    quietHoursEnd?: number;
  };
}

export interface PolicyDecisionResult {
  decision: "ALLOW" | "DENY" | "DEFER";
  reasons: RuleCode[];
  nextPermittedAt?: Date;
}

const CHANNEL_TO_CONSENT_SCOPE: Record<Channel, ConsentScope> = {
  VOICE: "CONTACT_VOICE",
  SMS: "CONTACT_SMS",
  EMAIL: "CONTACT_EMAIL",
};

// Default quiet hours; a subset of states declare a stricter start time.
const DEFAULT_QUIET_HOURS = { start: 8, end: 21 };
const STRICTER_STATE_QUIET_HOURS: Record<string, { start: number; end: number }> = {
  FL: { start: 9, end: 20 },
  WA: { start: 9, end: 21 },
  OR: { start: 9, end: 21 },
};

const DAILY_ATTEMPT_CAP = 3;
const MIN_SPACING_HOURS = 4;
const TERMINAL_STATES: LeadState[] = ["SUPPRESSED", "CLOSED_WON", "CLOSED_LOST"];
const OFFICER_OWNED_STATES: LeadState[] = ["ASSIGNED", "ACKNOWLEDGED"];

function localHourAndDay(now: Date, timezone: string): { hour: number; minute: number; weekday: number } | null {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      minute: "numeric",
      hour12: false,
      weekday: "short",
    });
    const parts = fmt.formatToParts(now);
    const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
    const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
    const weekdayShort = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
    const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return { hour, minute, weekday: weekdayMap[weekdayShort] ?? 0 };
  } catch {
    return null;
  }
}

function nextWindowOpen(now: Date, timezone: string, startHour: number): Date {
  // Walk forward minute-by-minute is wasteful; step by hour buckets using the
  // timezone offset derived from Intl, which is DST-safe by construction.
  const local = localHourAndDay(now, timezone);
  if (!local) return new Date(now.getTime() + 12 * 60 * 60 * 1000);
  const minutesUntilMidnight = (24 - local.hour) * 60 - local.minute;
  const minutesFromMidnightToStart = startHour * 60;
  const minutesUntilStart =
    local.hour < startHour
      ? minutesFromMidnightToStart - (local.hour * 60 + local.minute)
      : minutesUntilMidnight + minutesFromMidnightToStart;
  return new Date(now.getTime() + minutesUntilStart * 60 * 1000);
}

/**
 * Evaluate whether outbound contact on `channel` is permitted right now.
 * Rules run in the exact order from SPEC.md section 6. First DENY wins.
 */
export function evaluatePolicyGate(input: GateInput): PolicyDecisionResult {
  const {
    now,
    channel,
    personTimezone,
    consents,
    suppressions,
    attemptsToday,
    attemptsTotal,
    lastAttemptAt,
    leadState,
    killSwitchOn,
    cadenceStep,
    isManualOfficerAction,
  } = input;

  const dailyAttemptCap = input.config?.dailyAttemptCap ?? DAILY_ATTEMPT_CAP;
  const minSpacingHours = input.config?.minSpacingHours ?? MIN_SPACING_HOURS;
  const quietHours =
    input.config?.quietHoursStart !== undefined && input.config?.quietHoursEnd !== undefined
      ? { start: input.config.quietHoursStart, end: input.config.quietHoursEnd }
      : DEFAULT_QUIET_HOURS;

  // 1. KILL_SWITCH
  if (killSwitchOn) {
    return { decision: "DENY", reasons: ["KILL_SWITCH"] };
  }

  // 2. SUPPRESSED_GLOBAL
  const activeSuppressions = suppressions.filter(
    (s) => !s.expiresAt || new Date(s.expiresAt).getTime() > now.getTime()
  );
  if (activeSuppressions.some((s) => s.scope === "GLOBAL")) {
    return { decision: "DENY", reasons: ["SUPPRESSED_GLOBAL"] };
  }

  // 3. SUPPRESSED_CHANNEL
  if (activeSuppressions.some((s) => s.scope === "CHANNEL" && s.channel === channel)) {
    return { decision: "DENY", reasons: ["SUPPRESSED_CHANNEL"] };
  }

  // 4 & 5. Consent — no consent, or latest consent revoked
  const scope = CHANNEL_TO_CONSENT_SCOPE[channel];
  const latestConsent = consents.find((c) => c.scope === scope);
  if (!latestConsent) {
    return { decision: "DENY", reasons: ["NO_CONSENT"] };
  }
  if (!latestConsent.granted) {
    return { decision: "DENY", reasons: ["CONSENT_REVOKED"] };
  }

  // 6. LEAD_TERMINAL
  if (TERMINAL_STATES.includes(leadState)) {
    return { decision: "DENY", reasons: ["LEAD_TERMINAL"] };
  }

  // 7. OFFICER_OWNED — only blocks automated steps; a human can still act (call
  // now / manual override) once a lead is owned by the assigned officer.
  if (OFFICER_OWNED_STATES.includes(leadState) && !isManualOfficerAction) {
    return { decision: "DENY", reasons: ["OFFICER_OWNED"] };
  }

  // 8. ATTEMPT_CAP_TOTAL
  if (attemptsTotal >= cadenceStep.maxAttempts) {
    return { decision: "DENY", reasons: ["ATTEMPT_CAP_TOTAL"] };
  }

  // 9. UNKNOWN_TIMEZONE (never applies to EMAIL)
  if (personTimezone === "UNKNOWN" && channel !== "EMAIL") {
    // Defer to the next UTC-safe window (12:00 UTC), flagged for human review.
    const next = new Date(now);
    next.setUTCHours(12, 0, 0, 0);
    if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
    return { decision: "DEFER", reasons: ["UNKNOWN_TIMEZONE"], nextPermittedAt: next };
  }

  const timezone = personTimezone === "UNKNOWN" ? "UTC" : personTimezone;
  const local = localHourAndDay(now, timezone);

  if (channel !== "EMAIL" && local) {
    const stateHours = input.propertyStateCode
      ? STRICTER_STATE_QUIET_HOURS[input.propertyStateCode] ?? quietHours
      : quietHours;

    // 10. QUIET_HOURS_LOCAL
    const minutesNow = local.hour * 60 + local.minute;
    const startMinutes = stateHours.start * 60;
    const endMinutes = stateHours.end * 60;
    if (minutesNow < startMinutes || minutesNow >= endMinutes) {
      return {
        decision: "DEFER",
        reasons: ["QUIET_HOURS_LOCAL"],
        nextPermittedAt: nextWindowOpen(now, timezone, stateHours.start),
      };
    }

    // 13. WEEKEND_RULE (Sunday = 0)
    if (local.weekday === 0) {
      const next = nextWindowOpen(now, timezone, stateHours.start);
      // push forward one more day past Sunday
      next.setUTCDate(next.getUTCDate() + 1);
      return { decision: "DEFER", reasons: ["WEEKEND_RULE"], nextPermittedAt: next };
    }
  }

  // 11. ATTEMPT_CAP_DAILY
  if (attemptsToday >= dailyAttemptCap) {
    const stateHours = input.propertyStateCode
      ? STRICTER_STATE_QUIET_HOURS[input.propertyStateCode] ?? quietHours
      : quietHours;
    const next = nextWindowOpen(now, timezone, stateHours.start);
    next.setUTCDate(next.getUTCDate() + 1);
    return { decision: "DEFER", reasons: ["ATTEMPT_CAP_DAILY"], nextPermittedAt: next };
  }

  // 12. MIN_SPACING
  if (lastAttemptAt) {
    const hoursSince = (now.getTime() - lastAttemptAt.getTime()) / (1000 * 60 * 60);
    if (hoursSince < minSpacingHours) {
      const next = new Date(lastAttemptAt.getTime() + minSpacingHours * 60 * 60 * 1000);
      return { decision: "DEFER", reasons: ["MIN_SPACING"], nextPermittedAt: next };
    }
  }

  return { decision: "ALLOW", reasons: ["ALLOW"] };
}

export const RULE_DESCRIPTIONS: Record<RuleCode, string> = {
  KILL_SWITCH: "Global automation pause is active.",
  SUPPRESSED_GLOBAL: "Phone number has an active global suppression.",
  SUPPRESSED_CHANNEL: "Phone number is suppressed on this channel.",
  NO_CONSENT: "No granted consent on file for this channel.",
  CONSENT_REVOKED: "Latest consent record for this channel was revoked.",
  LEAD_TERMINAL: "Lead is in a terminal state (suppressed/closed).",
  OFFICER_OWNED: "Lead is owned by an assigned officer; automation is halted.",
  ATTEMPT_CAP_TOTAL: "Total attempt cap for this cadence step reached.",
  UNKNOWN_TIMEZONE: "Borrower timezone is unresolved; deferred to a safe window.",
  QUIET_HOURS_LOCAL: "Outside permitted local contact hours.",
  ATTEMPT_CAP_DAILY: "Daily attempt cap reached.",
  MIN_SPACING: "Minimum spacing between attempts not yet elapsed.",
  WEEKEND_RULE: "Contact is not permitted on Sundays for this state.",
  ALLOW: "All checks passed.",
};
