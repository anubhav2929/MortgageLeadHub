// Permission matrix — SPEC.md F-10. Single can() used by both server actions
// and UI rendering; never check roles inline in a component.

import type { Lead, Role } from "@/domain/types";

export type Action =
  | "VIEW_LEAD_PII"
  | "EXPORT_LEAD"
  | "EDIT_FIELDS"
  | "MANAGE_SUPPRESSION"
  | "EDIT_CADENCE_PROMPTS_DISCLOSURES"
  | "APPROVE_CADENCE_PROMPTS_DISCLOSURES"
  | "TOGGLE_KILL_SWITCH"
  | "VIEW_AUDIT_LOG"
  | "TAKE_OVER_LEAD"
  | "CALL_NOW"
  | "MARK_WON_LOST"
  | "ADD_NOTE"
  | "MANAGE_TASK"
  | "REQUEST_COMPLIANCE_REVIEW"
  | "VIEW_CALL_CENTER"
  | "VIEW_MESSAGE_CENTER"
  | "RERUN_PROPERTY_VALUATION";

export interface Subject {
  role: Role;
  officerId?: string;
  licensedStates?: string[];
}

export function can(user: Subject, action: Action, lead?: Lead): boolean {
  const { role } = user;

  switch (action) {
    case "VIEW_LEAD_PII":
      if (role === "ADMIN" || role === "COMPLIANCE") return true;
      if (role === "OFFICER") {
        if (!lead) return false;
        if (lead.assignedOfficerId === user.officerId) return true;
        return !lead.assignedOfficerId && Boolean(user.licensedStates?.includes(lead.stateCode));
      }
      return false; // READ_ONLY sees masked PII, never raw
    case "EXPORT_LEAD":
      if (role === "ADMIN" || role === "COMPLIANCE") return true;
      if (role === "OFFICER") return !!lead && lead.assignedOfficerId === user.officerId;
      return false;
    case "TAKE_OVER_LEAD":
      if (role === "ADMIN") return true;
      return role === "OFFICER" && !!lead && !lead.assignedOfficerId && Boolean(user.licensedStates?.includes(lead.stateCode));
    case "EDIT_FIELDS":
    case "CALL_NOW":
    case "MARK_WON_LOST":
      if (role === "ADMIN") return true;
      if (role === "OFFICER") return !!lead && lead.assignedOfficerId === user.officerId;
      return false;
    case "ADD_NOTE":
    case "MANAGE_TASK":
      if (role === "ADMIN" || role === "COMPLIANCE") return true;
      return role === "OFFICER" && !!lead && lead.assignedOfficerId === user.officerId;
    case "REQUEST_COMPLIANCE_REVIEW":
      if (role === "ADMIN") return true;
      return role === "OFFICER" && !!lead && lead.assignedOfficerId === user.officerId;
    case "VIEW_CALL_CENTER":
    case "VIEW_MESSAGE_CENTER":
      return role === "ADMIN" || role === "COMPLIANCE" || role === "OFFICER";
    case "MANAGE_SUPPRESSION":
    case "TOGGLE_KILL_SWITCH":
    case "VIEW_AUDIT_LOG":
      return role === "ADMIN" || role === "COMPLIANCE";
    case "EDIT_CADENCE_PROMPTS_DISCLOSURES":
    case "RERUN_PROPERTY_VALUATION":
      return role === "ADMIN";
    case "APPROVE_CADENCE_PROMPTS_DISCLOSURES":
      return role === "ADMIN" || role === "COMPLIANCE";
    default:
      return false;
  }
}

export function maskPhone(phone: string): string {
  return phone.replace(/\d(?=\d{2})/g, "•");
}

export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!domain) return "••••••";
  const visible = user.slice(0, 1);
  return `${visible}${"•".repeat(Math.max(3, user.length - 1))}@${domain}`;
}
