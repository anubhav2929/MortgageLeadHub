import type {
  LeadContextSnapshot,
  QualificationAnswer,
  QualificationDecision,
  QualificationProgress,
  QualificationQuestionPlanItem,
  QualificationQuestionId,
  ReferralType,
} from "@/domain/types";
import { redactRestrictedText } from "@/core/sensitiveText";

export interface QualificationQuestion {
  id: QualificationQuestionId;
  fieldPath: string;
  prompt: string;
  valueType: "string" | "number" | "boolean";
}

export const QUALIFICATION_QUESTIONS: Record<QualificationQuestionId, QualificationQuestion> = {
  timeline: { id: "timeline", fieldPath: "borrower.timeline", prompt: "When are you hoping to move forward?", valueType: "string" },
  property_address: { id: "property_address", fieldPath: "property.addressLine1", prompt: "What is the property address?", valueType: "string" },
  foreclosure_status: { id: "foreclosure_status", fieldPath: "hardship.facingForeclosure", prompt: "Are you currently facing foreclosure proceedings on the property?", valueType: "boolean" },
  occupancy: { id: "occupancy", fieldPath: "property.occupancy", prompt: "Is this your primary home, a second home, or an investment property?", valueType: "string" },
  estimated_value: { id: "estimated_value", fieldPath: "property.estimatedValue", prompt: "About what do you believe the property is worth today?", valueType: "number" },
  mortgage_balance: { id: "mortgage_balance", fieldPath: "loan.currentBalance", prompt: "About how much remains on the current mortgage?", valueType: "number" },
  cash_goal: { id: "cash_goal", fieldPath: "loan.purpose", prompt: "What would you like the refinance or home-equity funds to help with?", valueType: "string" },
  credit_range: { id: "credit_range", fieldPath: "borrower.creditBand", prompt: "Which broad credit range best describes you: below 620, 620 to 679, 680 to 739, 740 or higher, or unsure?", valueType: "string" },
  transfer_consent: { id: "transfer_consent", fieldPath: "qualification.transferConsent", prompt: "Would you like me to connect you with a licensed loan officer now?", valueType: "boolean" },
};

export const REQUIRED_QUALIFICATION_QUESTIONS: QualificationQuestionId[] = [
  "timeline",
  "property_address",
  "occupancy",
  "estimated_value",
  "mortgage_balance",
  "cash_goal",
  "credit_range",
  "transfer_consent",
];

export const QUALIFICATION_PLAN_VERSION = "adaptive_v2" as const;

const FORECLOSURE_QUESTIONS: QualificationQuestionId[] = [
  "timeline",
  "property_address",
  "foreclosure_status",
  "transfer_consent",
];

const LOAN_MODIFICATION_QUESTIONS: QualificationQuestionId[] = [
  "timeline",
  "property_address",
  "mortgage_balance",
  "transfer_consent",
];

const FRESH_FORM_REUSE_QUESTIONS = new Set<QualificationQuestionId>([
  "timeline",
  "property_address",
  "occupancy",
  "cash_goal",
]);

const FRESH_FORM_WINDOW_MS = 24 * 60 * 60 * 1_000;

function present(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "" && !["UNKNOWN", "UNSURE"].includes(value);
  if (typeof value === "number") return Number.isFinite(value) && value > 0;
  return true;
}

function snapshotValue(snapshot: LeadContextSnapshot, questionId: QualificationQuestionId): unknown {
  const values: Partial<Record<QualificationQuestionId, unknown>> = {
    timeline: snapshot.intake.timeline,
    property_address: snapshot.intake.addressLine1,
    occupancy: snapshot.intake.occupancy,
    estimated_value: snapshot.intake.estimatedValue,
    mortgage_balance: snapshot.intake.currentBalance,
    cash_goal: snapshot.intake.goal,
    credit_range: snapshot.intake.creditRange,
  };
  return values[questionId];
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isFreshFormSnapshot(snapshot: LeadContextSnapshot): boolean {
  const submittedAt = Date.parse(snapshot.intake.submittedAt ?? "");
  const snapshottedAt = Date.parse(snapshot.createdAt);
  return Number.isFinite(submittedAt)
    && Number.isFinite(snapshottedAt)
    && snapshottedAt >= submittedAt
    && snapshottedAt - submittedAt <= FRESH_FORM_WINDOW_MS;
}

function questionsForSnapshot(snapshot: LeadContextSnapshot): QualificationQuestionId[] {
  if (snapshot.intake.referralType === "FORECLOSURE") return FORECLOSURE_QUESTIONS;
  if (snapshot.intake.referralType === "LOAN_MODIFICATION") return LOAN_MODIFICATION_QUESTIONS;
  return REQUIRED_QUALIFICATION_QUESTIONS;
}

/** Build the call plan from server-owned evidence before Vapi is contacted.
 * The language model only receives the next actionable item; it never decides
 * whether a CRM value is trustworthy enough to skip. */
export function buildQualificationQuestionPlan(snapshot: LeadContextSnapshot): QualificationQuestionPlanItem[] {
  const freshForm = isFreshFormSnapshot(snapshot);
  return questionsForSnapshot(snapshot).map((questionId) => {
    if (questionId === "transfer_consent") {
      return { questionId, mode: "ASK", reason: "Current-call transfer consent is always required." };
    }
    if (questionId === "foreclosure_status") {
      return { questionId, mode: "ASK", reason: "Three-plus missed payments require the server-defined hardship branch." };
    }

    const question = QUALIFICATION_QUESTIONS[questionId];
    const formValue = snapshotValue(snapshot, questionId);
    const verifiedValue = snapshot.verifiedFields[question.fieldPath];
    const hasForm = present(formValue);
    const hasVerified = present(verifiedValue);

    if (!hasForm && !hasVerified) {
      return { questionId, mode: "ASK", reason: "No usable CRM value is available." };
    }
    if (hasForm && hasVerified && !sameValue(formValue, verifiedValue)) {
      return { questionId, mode: "REVIEW", reason: "Form and verified CRM values conflict.", source: "VERIFIED_FIELD" };
    }
    if (hasVerified) {
      return { questionId, mode: "REUSE", reason: "A verified CRM value is authoritative for this call.", source: "VERIFIED_FIELD" };
    }
    if (freshForm && FRESH_FORM_REUSE_QUESTIONS.has(questionId)) {
      return { questionId, mode: "REUSE", reason: "The borrower supplied this stable value on the form within 24 hours.", source: "FORM" };
    }
    return { questionId, mode: "CONFIRM", reason: "The CRM value exists but should be confirmed before use.", source: "FORM" };
  });
}

export function computeCallContextCompleteness(snapshot: LeadContextSnapshot): number {
  const informationItems = buildQualificationQuestionPlan(snapshot).filter((item) => item.questionId !== "transfer_consent" && item.questionId !== "foreclosure_status");
  if (informationItems.length === 0) return 100;
  const known = informationItems.filter((item) => item.mode !== "ASK").length;
  return Math.round((known / informationItems.length) * 100);
}

export function seedAnswersFromSnapshot(snapshot: LeadContextSnapshot, now: string): QualificationAnswer[] {
  const values: Partial<Record<QualificationQuestionId, unknown>> = {
    timeline: snapshot.intake.timeline,
    property_address: snapshot.intake.addressLine1,
    occupancy: snapshot.intake.occupancy,
    estimated_value: snapshot.intake.estimatedValue,
    mortgage_balance: snapshot.intake.currentBalance,
    cash_goal: snapshot.intake.goal,
    credit_range: snapshot.intake.creditRange,
  };
  return REQUIRED_QUALIFICATION_QUESTIONS.flatMap((questionId) => {
    const question = QUALIFICATION_QUESTIONS[questionId];
    const verified = snapshot.verifiedFields[question.fieldPath];
    const value = present(verified) ? verified : values[questionId];
    if (!present(value)) return [];
    return [{
      id: `${snapshot.id}:${questionId}`,
      leadId: snapshot.leadId,
      conversationId: snapshot.conversationId,
      questionId,
      fieldPath: question.fieldPath,
      value,
      confidence: present(verified) ? 1 : 0.95,
      source: present(verified) ? "VERIFIED_FIELD" : "FORM",
      transcriptTurnRefs: [],
      conflict: false,
      capturedAt: now,
    } satisfies QualificationAnswer];
  });
}

export function nextQualificationQuestion(progress: QualificationProgress): QualificationQuestion | undefined {
  // Calls opened before adaptive_v2 intentionally retain the former behavior:
  // only an explicit current-call answer advances them. New calls may also
  // advance over REUSE items, but only because the server planned that mode.
  const reused = new Set(
    (progress.questionPlan ?? [])
      .filter((item) => item.mode === "REUSE")
      .map((item) => item.questionId)
  );
  const answered = new Set(
    progress.answers
      .filter((answer) => answer.source === "BORROWER_STATED" && present(answer.value))
      .map((answer) => answer.questionId)
  );
  const id = progress.requiredQuestionIds.find((questionId) => !answered.has(questionId) && !reused.has(questionId));
  return id ? QUALIFICATION_QUESTIONS[id] : undefined;
}

export function qualificationPlanItem(progress: QualificationProgress, questionId: QualificationQuestionId): QualificationQuestionPlanItem {
  return progress.questionPlan?.find((item) => item.questionId === questionId)
    ?? { questionId, mode: "ASK", reason: "Legacy call requires an explicit current-call answer." };
}

export function normalizeQualificationAnswer(questionId: QualificationQuestionId, value: unknown): unknown {
  const question = QUALIFICATION_QUESTIONS[questionId];
  if (question.valueType === "boolean") {
    if (typeof value === "boolean") return value;
    if (typeof value === "string" && /^(yes|true|y)$/i.test(value.trim())) return true;
    if (typeof value === "string" && /^(no|false|n)$/i.test(value.trim())) return false;
    throw new Error("Expected a yes or no answer.");
  }
  if (question.valueType === "number") {
    const numeric = typeof value === "number" ? value : Number(String(value).replace(/[$,\s]/g, ""));
    if (!Number.isFinite(numeric) || numeric <= 0 || numeric > 100_000_000) throw new Error("Expected a realistic positive dollar amount.");
    return Math.round(numeric);
  }
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > 500) throw new Error("Expected a concise answer.");
  if (questionId === "timeline") {
    if (/asap|immediate|right away/i.test(text)) return "ASAP";
    if (/1\s*(?:-|to)\s*3|one to three/i.test(text)) return "1_3_MONTHS";
    if (/3\s*(?:-|to)\s*6|three to six/i.test(text)) return "3_6_MONTHS";
    if (/explor|research|unsure/i.test(text)) return "EXPLORING";
    throw new Error("Choose ASAP, 1–3 months, 3–6 months, or exploring.");
  }
  if (questionId === "occupancy") {
    if (/primary|main home/i.test(text)) return "PRIMARY";
    if (/second|vacation/i.test(text)) return "SECOND_HOME";
    if (/invest|rental/i.test(text)) return "INVESTMENT";
    throw new Error("Choose primary, second home, or investment property.");
  }
  if (questionId === "credit_range") {
    if (/unsure|don't know|do not know/i.test(text)) return "UNSURE";
    const score = Number(text.match(/\b\d{3}\b/)?.[0]);
    if (/740|excellent|higher|above/i.test(text) || score >= 740) return "EXCELLENT_740_PLUS";
    if (/680|739|good/i.test(text) || score >= 680) return "GOOD_680_739";
    if (/620|679|fair/i.test(text) || score >= 620) return "FAIR_620_679";
    if (/below|under|poor/i.test(text) || (score > 0 && score < 620)) return "BELOW_620";
    throw new Error("Choose a broad credit range or unsure.");
  }
  return redactRestrictedText(text).text;
}

export function decideQualification(
  progress: QualificationProgress,
  referralType: ReferralType | undefined,
  now: string
): QualificationDecision {
  if (referralType && referralType !== "NONE") {
    return { leadId: progress.leadId, conversationId: progress.conversationId, outcome: "REFERRAL", reasonCodes: [`REFERRAL_${referralType}`], decidedAt: now };
  }
  const next = nextQualificationQuestion(progress);
  const conflicts = progress.answers.filter((answer) => answer.conflict);
  if (next || conflicts.length > 0) {
    return {
      leadId: progress.leadId,
      conversationId: progress.conversationId,
      outcome: "NEEDS_REVIEW",
      reasonCodes: [...(next ? [`MISSING_${next.id.toUpperCase()}`] : []), ...conflicts.map((item) => `CONFLICT_${item.questionId.toUpperCase()}`)],
      decidedAt: now,
    };
  }
  const consent = [...progress.answers].reverse().find((answer) => answer.questionId === "transfer_consent");
  return {
    leadId: progress.leadId,
    conversationId: progress.conversationId,
    outcome: consent?.value === true ? "READY_FOR_TRANSFER" : "NEEDS_REVIEW",
    reasonCodes: consent?.value === true ? ["REQUIRED_ANSWERS_COMPLETE", "TRANSFER_CONSENTED"] : ["TRANSFER_DECLINED"],
    decidedAt: now,
  };
}
