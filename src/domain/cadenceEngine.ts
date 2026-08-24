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
import { shouldAutomateVoice } from "@/core/callStrategy";
import { evaluateChannelReadiness } from "@/core/channelReadiness";
import { getCapabilities } from "@/lib/runtimeConfig";
import { evaluateEngagementWindow } from "@/core/engagementWindow";
import { currentVoiceStrategy } from "@/domain/voiceOrchestrator";
import { transition, InvalidTransitionError } from "@/core/stateMachine";
import { getDb, nowIso, saveDb, type Database } from "@/domain/store";
import { evaluateForLead } from "@/domain/gateHelpers";
import { buildLeadThread } from "@/core/conversationThread";
import { selectBestChannel, describeRoute } from "@/core/channelRouter";
import { computeLeadQualityScore } from "@/core/leadScoring";
import type { Channel, Lead } from "@/domain/types";

const ROUTABLE_CHANNELS: Channel[] = ["SMS", "VOICE", "EMAIL"];

/** Borrower's local hour, for preferring async channels late in their day.
 * Unknown zones use a neutral routing score; PolicyGate independently
 * defers automated voice/SMS instead of guessing from property state. */
function borrowerLocalHour(timezone: string): number {
  if (!timezone || timezone === "UNKNOWN") return 12;
  try {
    return Number(new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", hourCycle: "h23" }).format(new Date()));
  } catch {
    return 12;
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

  // Deliberately WITHOUT the intake summary, unlike every AI-facing caller
  // (see domain/leadContext.ts). This thread feeds channel routing, which asks
  // "which channel does this borrower actually answer on?" — and scores
  // `repliedHere` higher than any other signal.
  //
  // The intake message is an INBOUND borrower message on PORTAL, so including
  // it would make every lead look like they had replied on the portal before
  // anyone contacted them. Harmless today because PORTAL is not a routable
  // channel, but it is the wrong input to this question and would misfire the
  // moment portal messaging became routable.
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
    localHour: borrowerLocalHour(
      Array.from(db.people.values()).find((person) => person.leadId === lead.id && person.role === "PRIMARY")?.timezone ?? "UNKNOWN"
    ),
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
  /** Provider rejected the send this tick. Distinct from `blocked`, which is
   *  our own PolicyGate declining to send. */
  failed: number;
  /** A voice step ran on another channel because no conversational agent is
   *  configured and an unattended robocall is not an acceptable substitute. */
  voiceDowngraded: number;
  /** Held because the borrower is actively engaged in the chat right now. */
  heldForEngagement: number;
  /** Steps held because the channel has no provider configured. */
  heldForChannel: number;
  /** Cadence is paused on this lead pending human action — a permanently bad
   *  contact address, or a provider misconfiguration affecting everyone. */
  heldForFailure: number;
  errors: { leadId: string; error: string }[];
}

export async function runCadenceTick(): Promise<CadenceTickSummary> {
  const db = await getDb();
  // Stamped at the START, not the end: a tick that throws partway through
  // still proves the scheduler is calling us, which is what this timestamp
  // is for. Recording it only on success would report a crashing engine as
  // an unwired scheduler and send someone to fix the wrong thing.
  db.lastCadenceRunAt = new Date().toISOString();
  const summary: CadenceTickSummary = { processed: 0, delivered: 0, blocked: 0, exhausted: 0, failed: 0, heldForFailure: 0, voiceDowngraded: 0, heldForEngagement: 0, heldForChannel: 0, errors: [] };

  // Resolved once per tick rather than per lead: it is the same answer for
  // every lead in the run, and it is a decrypt on each call.
  const caps = await getCapabilities();

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

      // A send the provider refused doesn't emit OUTREACH_ATTEMPTED, so the
      // step above is correctly still "next" — the cadence retries it rather
      // than skipping a borrower who was never actually reached. That retry
      // has to be bounded, though, or a permanently bad number is redialed
      // every tick forever.
      const lastFailure = [...db.attempts]
        .reverse()
        .find((a) => a.leadId === lead.id && a.outcome === "FAILED" && a.failureClass);

      if (lastFailure) {
        if (lastFailure.failureClass !== "TRANSIENT") {
          // PERMANENT (bad number/address) or CONFIGURATION (our credentials).
          // Neither is fixed by trying again, and both have already raised a
          // task for a human. Hold the cadence rather than burning provider
          // spend on a send that cannot succeed.
          summary.heldForFailure += 1;
          continue;
        }
        if (lastFailure.retryAfter && new Date(lastFailure.retryAfter).getTime() > Date.now()) {
          continue; // still inside the backoff window
        }
        if (lastFailure.retryAfter === undefined) {
          // decideRetry gave up after exhausting the transient retry budget.
          summary.heldForFailure += 1;
          continue;
        }
      }

      // The borrower is on the page right now. Texting or calling someone
      // mid-conversation in our own chat spends money to make the experience
      // worse — and it reveals the channels as separate systems, which is the
      // opposite of what this product is for. Hold, don't drop: the step stays
      // due and fires once the window lapses.
      const engagement = evaluateEngagementWindow({
        lastEngagedAt: lead.lastEngagedAt,
        now: new Date(),
        windowMinutes: db.config.engagementWindowMinutes,
        isAutomated: true,
      });
      if (engagement.defer) {
        summary.heldForEngagement += 1;
        await pushEvent({
          leadId: lead.id,
          type: "OUTREACH_DEFERRED",
          actorType: "SYSTEM",
          occurredAt: nowIso(),
          payload: { reason: engagement.reason, retryAt: engagement.retryAt?.toISOString() },
        });
        continue;
      }

      summary.processed += 1;
      let routed = await resolveChannel(db, lead, nextStep.channel, nextStep.autoRoute);

      // A cadence VOICE step exists to have a conversation. If no
      // conversational agent is configured, the only thing we could place is
      // a one-way recorded announcement — which cannot qualify anyone, costs
      // real money, and is exactly the repeated-robocall pattern TCPA
      // complaints are built on. Route to SMS instead and say why.
      if (routed.channel === "VOICE") {
        const strategy = await currentVoiceStrategy();
        if (!shouldAutomateVoice(strategy.mechanism)) {
          const fallback = await resolveChannel(db, lead, "SMS", true);
          console.log(
            `[cadence] lead ${lead.publicRef}: voice step downgraded to ${fallback.channel} — ${strategy.reason}`
          );
          summary.voiceDowngraded += 1;
          routed = fallback.channel === "VOICE" ? { channel: "SMS" } : fallback;
        }
      }

      if (routed.note) console.log(`[cadence-router] lead ${lead.publicRef}: ${routed.note}`);

      // Hold rather than fake it. An unconfigured channel does not fail — the
      // adapter logs the message and reports success — so without this the
      // step would be recorded as SENT, consume an attempt, and advance the
      // schedule. A lead would march through its whole cadence on a dead
      // channel and land in NURTURE having received nothing.
      const readiness = evaluateChannelReadiness({
        channel: routed.channel,
        hasSms: caps.hasSms,
        hasEmail: caps.hasResend,
        hasVoiceAgent: caps.hasVoiceAgent,
        isAutomated: true,
      });
      if (!readiness.ready) {
        summary.heldForChannel += 1;
        console.warn(`[cadence] lead ${lead.publicRef}: ${routed.channel} step held — ${readiness.reason}`);
        await pushEvent({
          leadId: lead.id,
          type: "OUTREACH_DEFERRED",
          actorType: "SYSTEM",
          channel: routed.channel,
          occurredAt: nowIso(),
          payload: { reason: readiness.reason, heldFor: "channel_not_configured" },
        });
        continue;
      }

      const result = await deliverOutreach(db, lead, routed.channel, "SYSTEM", "automated_cadence_step");
      if (result.blocked) summary.blocked += 1;
      else if (result.ok) summary.delivered += 1;
      else summary.failed += 1;
    } catch (err) {
      summary.errors.push({ leadId: lead.id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  await saveDb();
  return summary;
}
