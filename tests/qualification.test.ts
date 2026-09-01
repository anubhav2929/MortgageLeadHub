import { describe, expect, it } from "vitest";
import {
  buildQualificationQuestionPlan,
  decideQualification,
  nextQualificationQuestion,
  normalizeQualificationAnswer,
  seedAnswersFromSnapshot,
} from "@/core/qualification";
import type { LeadContextSnapshot, QualificationProgress } from "@/domain/types";

const snapshot: LeadContextSnapshot = {
  id: "ctx", leadId: "lead", conversationId: "conv", createdAt: "2026-08-24T00:00:00Z",
  contextVersion: "call_context_v2", questionPlanVersion: "adaptive_v2", completenessPercentage: 100,
  promptVersionId: "p", profileVersionId: "v", borrower: { firstName: "A", timezone: "America/Los_Angeles" },
  intake: { submittedAt: "2026-08-23T23:30:00Z", intent: "REFINANCE", goal: "LOWER_PAYMENT", timeline: "ASAP", stateCode: "CA", occupancy: "PRIMARY", addressLine1: "1 Main St", estimatedValue: 500000, currentBalance: 250000, creditRange: "GOOD_680_739" },
  verifiedFields: { "borrower.timeline": "1_3_MONTHS" }, fieldEvidence: {}, excludedSensitiveFields: ["ssn"],
};

describe("server-owned qualification sequencing", () => {
  it("uses verified values as context but still requires current-call confirmation", () => {
    const answers = seedAnswersFromSnapshot(snapshot, snapshot.createdAt);
    expect(answers.find((item) => item.questionId === "timeline")?.value).toBe("1_3_MONTHS");
    const progress: QualificationProgress = { leadId: "lead", conversationId: "conv", snapshotId: "ctx", answers, requiredQuestionIds: ["timeline", "transfer_consent"], updatedAt: snapshot.createdAt };
    expect(nextQualificationQuestion(progress)?.id).toBe("timeline");

    progress.answers.push({
      id: "current-call", leadId: "lead", conversationId: "conv", questionId: "timeline",
      fieldPath: "borrower.timeline", value: "1_3_MONTHS", confidence: 1,
      source: "BORROWER_STATED", transcriptTurnRefs: [2], conflict: false,
      capturedAt: snapshot.createdAt,
    });
    expect(nextQualificationQuestion(progress)?.id).toBe("transfer_consent");
  });

  it("never clears a missing or conflicting answer", () => {
    const answers = seedAnswersFromSnapshot(snapshot, snapshot.createdAt);
    answers.push({ ...answers[0], id: "conflict", questionId: "transfer_consent", fieldPath: "qualification.transferConsent", value: true, source: "BORROWER_STATED", conflict: true });
    const progress: QualificationProgress = { leadId: "lead", conversationId: "conv", snapshotId: "ctx", answers, requiredQuestionIds: ["timeline", "transfer_consent"], updatedAt: snapshot.createdAt };
    const decision = decideQualification(progress, "NONE", snapshot.createdAt);
    expect(decision.outcome).toBe("NEEDS_REVIEW");
    expect(decision.reasonCodes).toContain("CONFLICT_TRANSFER_CONSENT");
  });

  it("reduces an exact score to a broad band rather than retaining it", () => {
    expect(normalizeQualificationAnswer("credit_range", "My score is 715")).toBe("GOOD_680_739");
  });

  it("builds a server-owned adaptive plan from freshness and provenance", () => {
    const plan = buildQualificationQuestionPlan(snapshot);

    expect(plan.find((item) => item.questionId === "timeline")?.mode).toBe("REVIEW");
    expect(plan.find((item) => item.questionId === "property_address")?.mode).toBe("REUSE");
    expect(plan.find((item) => item.questionId === "estimated_value")?.mode).toBe("CONFIRM");
    expect(plan.find((item) => item.questionId === "transfer_consent")?.mode).toBe("ASK");
  });

  it("uses the short hardship path for a foreclosure referral", () => {
    const plan = buildQualificationQuestionPlan({
      ...snapshot,
      intake: { ...snapshot.intake, missedPayments: "THREE_PLUS", referralType: "FORECLOSURE" },
      verifiedFields: {},
    });

    expect(plan.map((item) => item.questionId)).toEqual([
      "timeline",
      "property_address",
      "foreclosure_status",
      "transfer_consent",
    ]);
    expect(plan.find((item) => item.questionId === "foreclosure_status")?.mode).toBe("ASK");
    expect(normalizeQualificationAnswer("foreclosure_status", "yes")).toBe(true);
  });

  it("skips only questions explicitly marked REUSE by the server", () => {
    const answers = seedAnswersFromSnapshot(snapshot, snapshot.createdAt);
    const progress: QualificationProgress = {
      leadId: "lead",
      conversationId: "conv",
      snapshotId: "ctx",
      answers,
      requiredQuestionIds: ["property_address", "estimated_value", "transfer_consent"],
      questionPlanVersion: "adaptive_v2",
      questionPlan: [
        { questionId: "property_address", mode: "REUSE", reason: "fresh form" },
        { questionId: "estimated_value", mode: "CONFIRM", reason: "financial estimate" },
        { questionId: "transfer_consent", mode: "ASK", reason: "current call" },
      ],
      updatedAt: snapshot.createdAt,
    };

    expect(nextQualificationQuestion(progress)?.id).toBe("estimated_value");
  });
});
