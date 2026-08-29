import { describe, expect, it } from "vitest";
import { decideQualification, nextQualificationQuestion, normalizeQualificationAnswer, seedAnswersFromSnapshot } from "@/core/qualification";
import type { LeadContextSnapshot, QualificationProgress } from "@/domain/types";

const snapshot: LeadContextSnapshot = {
  id: "ctx", leadId: "lead", conversationId: "conv", createdAt: "2026-08-24T00:00:00Z",
  promptVersionId: "p", profileVersionId: "v", borrower: { firstName: "A", timezone: "America/Los_Angeles" },
  intake: { intent: "REFINANCE", goal: "LOWER_PAYMENT", timeline: "ASAP", stateCode: "CA", occupancy: "PRIMARY", addressLine1: "1 Main St", estimatedValue: 500000, currentBalance: 250000, creditRange: "GOOD_680_739" },
  verifiedFields: { "borrower.timeline": "1_3_MONTHS" }, excludedSensitiveFields: ["ssn"],
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
});
