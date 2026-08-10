import { describe, expect, it } from "vitest";
import { can, maskEmail, maskPhone } from "@/core/rbac";
import type { Lead } from "@/domain/types";

// One permission matrix, used by both server actions and UI rendering. The
// tests below are written from the perspective of "what must a role NEVER be
// able to do", because that is the direction where a mistake is a breach
// rather than a support ticket.

const lead = (assignedOfficerId?: string) => ({ id: "l1", assignedOfficerId } as Lead);

describe("READ_ONLY", () => {
  it("cannot see raw PII", () => {
    expect(can({ role: "READ_ONLY" }, "VIEW_LEAD_PII", lead())).toBe(false);
  });

  it("cannot export, edit, or act on a lead", () => {
    for (const action of ["EXPORT_LEAD", "EDIT_FIELDS", "CALL_NOW", "TAKE_OVER_LEAD", "MARK_WON_LOST"] as const) {
      expect(can({ role: "READ_ONLY" }, action, lead())).toBe(false);
    }
  });

  it("cannot touch the kill switch or suppression list", () => {
    expect(can({ role: "READ_ONLY" }, "TOGGLE_KILL_SWITCH")).toBe(false);
    expect(can({ role: "READ_ONLY" }, "MANAGE_SUPPRESSION")).toBe(false);
  });
});

describe("OFFICER — scoped to their own book", () => {
  const me = { role: "OFFICER" as const, officerId: "off1" };

  it("can act on a lead assigned to them", () => {
    expect(can(me, "EDIT_FIELDS", lead("off1"))).toBe(true);
    expect(can(me, "CALL_NOW", lead("off1"))).toBe(true);
    expect(can(me, "EXPORT_LEAD", lead("off1"))).toBe(true);
  });

  it("cannot act on another officer's lead", () => {
    expect(can(me, "EDIT_FIELDS", lead("off2"))).toBe(false);
    expect(can(me, "CALL_NOW", lead("off2"))).toBe(false);
    expect(can(me, "EXPORT_LEAD", lead("off2"))).toBe(false);
  });

  it("cannot act with no lead in context", () => {
    // A missing lead must fail closed, not default to permitted.
    expect(can(me, "EDIT_FIELDS")).toBe(false);
    expect(can(me, "EXPORT_LEAD")).toBe(false);
  });

  it("may view PII on an unassigned lead, so it can be picked up", () => {
    expect(can(me, "VIEW_LEAD_PII", lead(undefined))).toBe(true);
  });

  it("may not export an unassigned lead, even though they can view it", () => {
    // Viewing to triage is fine; walking out with the data is not.
    expect(can(me, "EXPORT_LEAD", lead(undefined))).toBe(false);
  });

  it("cannot toggle the kill switch, manage suppression, or read the audit log", () => {
    expect(can(me, "TOGGLE_KILL_SWITCH")).toBe(false);
    expect(can(me, "MANAGE_SUPPRESSION")).toBe(false);
    expect(can(me, "VIEW_AUDIT_LOG")).toBe(false);
  });

  it("cannot edit or approve cadences, prompts, or disclosures", () => {
    expect(can(me, "EDIT_CADENCE_PROMPTS_DISCLOSURES")).toBe(false);
    expect(can(me, "APPROVE_CADENCE_PROMPTS_DISCLOSURES")).toBe(false);
  });
});

describe("COMPLIANCE — oversight without origination", () => {
  const me = { role: "COMPLIANCE" as const };

  it("can see everything and read the audit log", () => {
    expect(can(me, "VIEW_LEAD_PII", lead("off1"))).toBe(true);
    expect(can(me, "VIEW_AUDIT_LOG")).toBe(true);
    expect(can(me, "EXPORT_LEAD", lead("off1"))).toBe(true);
  });

  it("can stop outreach and approve content", () => {
    expect(can(me, "TOGGLE_KILL_SWITCH")).toBe(true);
    expect(can(me, "MANAGE_SUPPRESSION")).toBe(true);
    expect(can(me, "APPROVE_CADENCE_PROMPTS_DISCLOSURES")).toBe(true);
  });

  it("cannot author the content it approves", () => {
    // Separation of duties: the approver must not also be the editor.
    expect(can(me, "EDIT_CADENCE_PROMPTS_DISCLOSURES")).toBe(false);
  });

  it("cannot contact borrowers or close deals", () => {
    expect(can(me, "CALL_NOW", lead("off1"))).toBe(false);
    expect(can(me, "MARK_WON_LOST", lead("off1"))).toBe(false);
  });
});

describe("ADMIN", () => {
  it("is permitted every defined action", () => {
    const actions = [
      "VIEW_LEAD_PII", "EXPORT_LEAD", "EDIT_FIELDS", "MANAGE_SUPPRESSION",
      "EDIT_CADENCE_PROMPTS_DISCLOSURES", "APPROVE_CADENCE_PROMPTS_DISCLOSURES",
      "TOGGLE_KILL_SWITCH", "VIEW_AUDIT_LOG", "TAKE_OVER_LEAD", "CALL_NOW", "MARK_WON_LOST",
    ] as const;
    for (const action of actions) {
      expect(can({ role: "ADMIN" }, action, lead("off9"))).toBe(true);
    }
  });
});

describe("masking", () => {
  it("leaves only the last two digits of a phone number", () => {
    const masked = maskPhone("+15551234567");
    expect(masked.endsWith("67")).toBe(true);
    expect(masked).not.toContain("5551234");
  });

  it("keeps the email domain but hides the local part", () => {
    const masked = maskEmail("jennifer.martinez@example.com");
    expect(masked.startsWith("j")).toBe(true);
    expect(masked.endsWith("@example.com")).toBe(true);
    expect(masked).not.toContain("martinez");
  });

  it("does not reveal a one-character local part's length", () => {
    expect(maskEmail("a@example.com")).toBe("a•••@example.com");
  });

  it("returns an opaque value for a malformed email rather than echoing it", () => {
    expect(maskEmail("not-an-email")).toBe("••••••");
  });
});
