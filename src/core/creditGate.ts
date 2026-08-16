// When a soft credit pull is allowed to fire. Pure, no I/O.
//
// Two independent reasons this is gated rather than automatic:
//
//  1. COST. Every iSoftpull inquiry is billed. Firing it the moment someone
//     types a name and address means paying for every tyre-kicker and every
//     abandoned form. The pull only earns its cost once the borrower has
//     shown real intent.
//
//  2. LAW. A soft pull is a consumer report under FCRA. It needs a
//     permissible purpose AND the consumer's authorisation — and that
//     authorisation has to be captured *before* the inquiry, not implied by
//     the fact they filled in a form. A disclosure is not an authorisation.
//
// Both reasons point at the same design: an explicit gate the borrower has to
// cross, with a consent checkbox sitting on it.

import type { GoalType, LoanIntent, MissedPayments, Timeline } from "@/domain/types";

/** How the borrower reached the gate. Recorded so an audit can show which
 *  interaction produced the authorisation. */
export type CreditPullTrigger =
  /** Finished the deeper qualification questions in the intake form. */
  | "INTAKE_QUALIFIED"
  /** Explicitly pressed the pre-qualification button in the post-submit chat. */
  | "CHAT_PREQUAL_REQUEST"
  /** A licensed officer requested it from the workspace. */
  | "OFFICER_REQUEST";

export interface CreditGateInput {
  trigger: CreditPullTrigger;
  /** The borrower ticked the FCRA authorisation box at the gate. */
  hasFcraConsent: boolean;
  /** Identity fields iSoftpull needs. A pull without these just wastes money. */
  firstName?: string;
  lastName?: string;
  addressLine1?: string;
  city?: string;
  stateCode?: string;
  /** Qualification signals — only consulted for the INTAKE_QUALIFIED trigger. */
  intent?: LoanIntent;
  goal?: GoalType;
  timeline?: Timeline;
  missedPayments?: MissedPayments;
  /** Pulls already run for this lead, to stop duplicate billing. */
  previousPullCount?: number;
}

export type CreditGateDecision =
  | { allowed: true; trigger: CreditPullTrigger; reason: string }
  | { allowed: false; reason: string; blocker: CreditGateBlocker };

export type CreditGateBlocker =
  | "NO_FCRA_CONSENT"
  | "INSUFFICIENT_IDENTITY"
  | "LOW_INTENT"
  | "ALREADY_PULLED";

/** More than one pull per lead is almost always a bug or a double-click, and
 *  each one is billed. An officer who genuinely needs a re-pull can clear it. */
const MAX_PULLS_PER_LEAD = 1;

/**
 * Does this borrower's answer set represent real intent?
 *
 * Deliberately generous: the point is to exclude people who opened the form
 * and typed nothing meaningful, not to pre-qualify the loan. Anyone who told
 * us what they want, when, and what shape their mortgage is in has spent
 * enough effort to be worth an inquiry.
 */
export function meetsIntentThreshold(input: CreditGateInput): boolean {
  const answeredWhat = Boolean(input.intent && input.intent !== "UNKNOWN") && Boolean(input.goal);
  const answeredWhen = Boolean(input.timeline);
  const answeredSituation = Boolean(input.missedPayments);
  return answeredWhat && answeredWhen && answeredSituation;
}

/** iSoftpull matches on name + address. Anything less is a guaranteed miss. */
export function hasIdentityForPull(input: CreditGateInput): boolean {
  return Boolean(
    input.firstName?.trim() &&
      input.lastName?.trim() &&
      input.addressLine1?.trim() &&
      input.stateCode?.trim()
  );
}

/**
 * The single decision point. Every caller — intake, chat, workspace — goes
 * through here, so there is exactly one place where "may we pull credit?" is
 * answered and exactly one place to audit.
 */
export function evaluateCreditGate(input: CreditGateInput): CreditGateDecision {
  // Consent first. Nothing else can substitute for it, and no trigger — not
  // even an officer's — can proceed without the borrower's authorisation.
  if (!input.hasFcraConsent) {
    return {
      allowed: false,
      blocker: "NO_FCRA_CONSENT",
      reason: "The borrower has not authorised a credit inquiry. FCRA requires explicit authorisation before any pull.",
    };
  }

  if ((input.previousPullCount ?? 0) >= MAX_PULLS_PER_LEAD) {
    return {
      allowed: false,
      blocker: "ALREADY_PULLED",
      reason: "A soft pull has already run for this lead. Each inquiry is billed, so repeats are blocked.",
    };
  }

  if (!hasIdentityForPull(input)) {
    return {
      allowed: false,
      blocker: "INSUFFICIENT_IDENTITY",
      reason: "A soft pull needs a full name and street address to match against. Collect those first.",
    };
  }

  // An explicit button press and an officer's request are themselves the
  // intent signal — there is nothing more to prove. Only the passive
  // "they finished the form" path has to clear the questionnaire bar.
  if (input.trigger === "INTAKE_QUALIFIED" && !meetsIntentThreshold(input)) {
    return {
      allowed: false,
      blocker: "LOW_INTENT",
      reason: "The borrower has not completed enough of the qualification questions to justify a billed inquiry.",
    };
  }

  const why: Record<CreditPullTrigger, string> = {
    INTAKE_QUALIFIED: "Borrower completed the qualification questions and authorised the inquiry.",
    CHAT_PREQUAL_REQUEST: "Borrower explicitly requested pre-qualification and authorised the inquiry.",
    OFFICER_REQUEST: "Licensed officer requested the inquiry with the borrower's authorisation on file.",
  };

  return { allowed: true, trigger: input.trigger, reason: why[input.trigger] };
}

/**
 * The authorisation text shown at the gate, stored verbatim with the consent
 * record. If this wording ever changes, the stored snapshot is what proves
 * what a given borrower actually agreed to.
 */
export const FCRA_CREDIT_AUTHORIZATION_TEXT =
  "I authorise Equity Flow Group and its lending partners to obtain my credit report and credit score " +
  "for the purpose of pre-qualifying me for a mortgage product. I understand this is a SOFT inquiry " +
  "that will NOT affect my credit score and will not appear to other lenders. I understand I am not " +
  "required to agree in order to have my inquiry reviewed.";

/** Version the text so a future reword is distinguishable in the audit trail. */
export const FCRA_CREDIT_AUTHORIZATION_VERSION = "fcra-soft-pull-v1";
