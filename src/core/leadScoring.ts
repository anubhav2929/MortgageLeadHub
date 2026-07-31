// Scientific lead quality scoring — Equity Flow Group business plan §5
// (100-point matrix). Predicts Expected Revenue Per Lead / closing
// probability so leads route to the right channel: score > hotLeadThreshold
// (default 80) → instant officer hot-transfer; at or below → standard
// AI-calling/SMS nurture flow.
//
// Deliberately NOT the same thing as completeness score (core/completeness.ts)
// — that measures how much 1003-aligned data has been collected; this
// predicts deal quality/revenue from data that's usually available at the
// moment of intake, before any of that data collection has happened.
//
// Pure function, no side effects — same convention as completeness.ts,
// policyGate.ts, and stateMachine.ts elsewhere in core/.

import type { GoalType, LoanIntent, MissedPayments, ScoringWeights, Timeline } from "@/domain/types";
import { LICENSING_PRIORITY_STATES, STATE_NAMES } from "@/domain/stateTimezone";

export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  equity: 40,
  margin: 25,
  compliance: 20,
  behavior: 15,
};

export const DEFAULT_HOT_LEAD_THRESHOLD = 80;

export interface LeadScoringInput {
  stateCode: string;
  intent: LoanIntent;
  goal: GoalType;
  timeline: Timeline;
  missedPayments?: MissedPayments;
  /** Best available estimate of market value — AVM if present, else self-reported. */
  estimatedValue?: number;
  /** Best available estimate of outstanding balance — self-reported preferred over AVM. */
  mortgageBalance?: number;
  intakeDurationSeconds?: number;
  /** Borrower-side conversation text scanned for urgency keywords, if any exists yet. */
  borrowerUtterances?: string[];
}

export interface LeadScoreBreakdown {
  equity: number;
  margin: number;
  compliance: number;
  behavior: number;
}

export type LeadScoreTier = "HOT" | "STANDARD";

export interface LeadScoreResult {
  total: number;
  breakdown: LeadScoreBreakdown;
  tier: LeadScoreTier;
  ltv: number | null;
}

const URGENT_KEYWORDS = [
  "right now",
  "asap",
  "as soon as possible",
  "immediately",
  "urgent",
  "behind on",
  "missed payment",
  "past due",
  "overdue",
  "foreclosure",
  "pay off",
  "high interest",
];

function hasUrgentKeywordMatch(utterances: string[] | undefined): boolean {
  if (!utterances || utterances.length === 0) return false;
  const combined = utterances.join(" ").toLowerCase();
  return URGENT_KEYWORDS.some((k) => combined.includes(k));
}

/** LTV ≤70% (≥$100k+ equity headroom): full marks. 70-80%: partial. >80%: none. */
function scoreEquity(estimatedValue: number | undefined, mortgageBalance: number | undefined, max: number): { points: number; ltv: number | null } {
  if (!estimatedValue || estimatedValue <= 0 || mortgageBalance === undefined) {
    return { points: 0, ltv: null };
  }
  const ltv = (mortgageBalance / estimatedValue) * 100;
  if (ltv <= 70) return { points: max, ltv };
  if (ltv <= 80) return { points: Math.round(max * (25 / 40)), ltv };
  return { points: 0, ltv };
}

/** Cash-out / debt consolidation carries the highest commission + urgency;
 *  home equity / second-lien products next; rate & term refi lowest. */
function scoreMargin(intent: LoanIntent, goal: GoalType, max: number): number {
  const isCashOutOrDebtConsolidation = intent === "CASH_OUT" || goal === "CASH_OUT" || goal === "DEBT_CONSOLIDATION";
  if (isCashOutOrDebtConsolidation) return max;
  if (intent === "HOME_EQUITY") return Math.round(max * (20 / 25));
  return Math.round(max * (10 / 25));
}

/** Binary match against active NMLS state-licensing footprint. */
function scoreCompliance(stateCode: string, max: number): number {
  if (LICENSING_PRIORITY_STATES.has(stateCode)) return max;
  if (STATE_NAMES[stateCode]) return Math.round(max * (10 / 20));
  return 0; // not licensed here — should route to an external partner
}

/** Time-decay response velocity + high-intent signal. Fast completion is
 *  only a full-marks signal when paired with genuine urgency — matches the
 *  plan's "high-urgency keywords + fast completion: 15 / standard: 8". */
function scoreBehavior(input: LeadScoringInput, max: number): number {
  const structuredUrgency =
    input.timeline === "ASAP" && (input.goal === "DEBT_CONSOLIDATION" || input.goal === "CASH_OUT" || (!!input.missedPayments && input.missedPayments !== "NONE"));
  const urgent = structuredUrgency || hasUrgentKeywordMatch(input.borrowerUtterances);
  const fastCompletion = input.intakeDurationSeconds !== undefined && input.intakeDurationSeconds < 120;

  if (urgent && fastCompletion) return max;
  return Math.round(max * (8 / 15));
}

export function computeLeadQualityScore(
  input: LeadScoringInput,
  weights: ScoringWeights = DEFAULT_SCORING_WEIGHTS,
  hotLeadThreshold: number = DEFAULT_HOT_LEAD_THRESHOLD
): LeadScoreResult {
  const equityResult = scoreEquity(input.estimatedValue, input.mortgageBalance, weights.equity);
  const breakdown: LeadScoreBreakdown = {
    equity: equityResult.points,
    margin: scoreMargin(input.intent, input.goal, weights.margin),
    compliance: scoreCompliance(input.stateCode, weights.compliance),
    behavior: scoreBehavior(input, weights.behavior),
  };
  const total = breakdown.equity + breakdown.margin + breakdown.compliance + breakdown.behavior;

  return {
    total,
    breakdown,
    tier: total > hotLeadThreshold ? "HOT" : "STANDARD",
    ltv: equityResult.ltv,
  };
}
