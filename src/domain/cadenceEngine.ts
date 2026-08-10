// Automated cadence execution — the piece that actually runs a lead's
// cadence plan over time. Before this existed, cadence plans were only a
// schedule *definition* (admin-editable, per domain/actions.ts
// updateCadencePlanAction) with nothing to execute it: every contact
// attempt in the app was triggered by a human clicking a button in the
// officer workspace, or by the borrower on the post-submit page. Intended
// to be invoked by a scheduled trigger (Vercel Cron, or any external
// pinger) hitting src/app/api/cron/cadence/route.ts.
//
// Design, kept deliberately simple: each cadence step fires once, in
// order, when its offsetMinutes has elapsed since the lead was created.
// PolicyGate (via deliverOutreach) is still the only thing that decides
// whether an attempt is actually allowed — this engine just decides *when*
// to ask.

import { deliverOutreach, pushEvent } from "@/domain/actions";
import { transition, InvalidTransitionError } from "@/core/stateMachine";
import { getDb, nowIso, saveDb, type Database } from "@/domain/store";
import { evaluateForLead } from "@/domain/gateHelpers";
import { buildLeadThread } from "@/core/conversationThread";
import { selectBestChannel, describeRoute } from "@/core/channelRouter";
import { computeLeadQualityScore } from "@/core/leadScoring";
import { STATE_TIMEZONE } from "@/domain/stateTimezone";
import type { Channel, Lead } from "@/domain/types";

const ROUTABLE_CHANNELS: Channel[] = ["SMS", "VOICE", "EMAIL"];

/** Borrower's local hour, for preferring async channels late in their day.
 *  Falls back to server-local if the state has no mapped timezone. */
function borrowerLocalHour(stateCode: string): number {
  const tz = STATE_TIMEZONE[stateCode];
  if (!tz) return new Date().getHours();
  try {
    return Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false }).format(new Date()));
  } catch {
    return new Date().getHours();
  }
}

/** Picks the channel for a step flagged autoRoute, from what this borrower has
 *  actually consented to and engaged with. Returns the step's authored channel
 *  unchanged when routing is off or nothing is permitted. */
async function resolveChannel(db: Database, lead: Lead, fallback: Channel, autoRoute?: boolean): Promise<{ channel: Channel; note?: string }> {
  if (!autoRoute) return { channel: fallback };

  const allowed: Channel[] = [];
  for (const c of ROUTABLE_CHANNELS) {
    const decision = await evaluateForLead(lead, c, false);
    if (decision.decision === "ALLOW") allowed.push(c);
  }
  if (allowed.length === 0) return { channel: fallback };

  const thread = buildLeadThread({
    attempts: db.attempts.filter((a) => a.leadId === lead.id),
    conversations: Array.from(db.conversations.values()).filter((c) => c.leadId === lead.id),
    notes: db.notes.filter((n) => n.leadId === lead.id),
  });

  const score = computeLeadQualityScore(
    {
      stateCode: lead.stateCode,
      intent: lead.intent,
      goal: lead.goal,
      timeline: lead.timeline,
      missedPayments: lead.missedPayments,
      estimatedValue: lead.estimatedValue,
      mortgageBalance: lead.currentBalance,
      intakeDurationSeconds: lead.intakeDurationSeconds,
    },
    db.config.scoringWeights,
    db.config.hotLeadThreshold
  );

  const route = selectBestChannel({
    allowedChannels: allowed,
    thread,
    localHour: borrowerLocalHour(lead.stateCode),
    leadScore: score.total,
    hotLeadThreshold: db.config.hotLeadThreshold,
  });

  return route.channel ? { channel: route.channel, note: describeRoute(route) } : { channel: fallback };
}

// Only leads still trying to make first live contact are automation's
// business — once a human is in the loop (assigned/acknowledged) or the
// lead is done/nurture/suppressed, automation stands down.
const AUTOMATION_ELIGIBLE_STATES: Lead["state"][] = ["NEW", "ATTEMPTING_CONTACT"];

export interface CadenceTickSummary {
  processed: number;
  delivered: number;
  blocked: number;
  exhausted: number;
  errors: { leadId: string; error: string }[];
}

export async function runCadenceTick(): Promise<CadenceTickSummary> {
  const db = await getDb();
  const summary: CadenceTickSummary = { processed: 0, delivered: 0, blocked: 0, exhausted: 0, errors: [] };

  const eligibleLeads = Array.from(db.leads.values()).filter((lead) => AUTOMATION_ELIGIBLE_STATES.includes(lead.state));

  for (const lead of eligibleLeads) {
    try {
      const plan = db.cadencePlans.get(lead.cadencePlanVersionId);
      if (!plan || plan.steps.length === 0) continue;

      const steps = [...plan.steps].sort((a, b) => a.offsetMinutes - b.offsetMinutes);
      // How many cadence steps have actually fired for this lead — counted
      // from events tagged with this engine's own reason, not from
      // db.attempts as a whole. Attempts also include manual officer
      // sends (Call now / compose email / SMS), which aren't part of the
      // schedule; counting those would silently skip cadence steps every
      // time an officer touched the lead by hand. A blocked cadence
      // attempt deliberately isn't counted here either — that's the
      // "retry this same step later" behavior for temporary blocks like
      // quiet hours, not a reason to advance past it.
      const attemptsSoFar = db.events.filter(
        (e) => e.leadId === lead.id && e.type === "OUTREACH_ATTEMPTED" && e.payload?.reason === "automated_cadence_step"
      ).length;

      if (attemptsSoFar >= steps.length) {
        // Cadence exhausted with no answer yet — park it in NURTURE instead
        // of silently doing nothing forever.
        if (lead.state !== "NURTURE") {
          try {
            lead.state = transition(lead.state, "MAX_ATTEMPTS_REACHED");
            lead.updatedAt = nowIso();
            summary.exhausted += 1;
            await pushEvent({ leadId: lead.id, type: "CADENCE_EXHAUSTED", actorType: "SYSTEM", occurredAt: nowIso() });
          } catch (err) {
            if (!(err instanceof InvalidTransitionError)) throw err;
          }
        }
        continue;
      }

      const nextStep = steps[attemptsSoFar];
      const elapsedMinutes = (Date.now() - new Date(lead.createdAt).getTime()) / 60000;
      if (elapsedMinutes < nextStep.offsetMinutes) continue; // not due yet

      summary.processed += 1;
      const routed = await resolveChannel(db, lead, nextStep.channel, nextStep.autoRoute);
      if (routed.note) console.log(`[cadence-router] lead ${lead.publicRef}: ${routed.note}`);
      const result = await deliverOutreach(db, lead, routed.channel, "SYSTEM", "automated_cadence_step");
      if (result.blocked) summary.blocked += 1;
      else if (result.ok) summary.delivered += 1;
    } catch (err) {
      summary.errors.push({ leadId: lead.id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  saveDb();
  return summary;
}
