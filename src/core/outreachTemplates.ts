import type { LeadState, LoanIntent } from "@/domain/types";

export interface OutreachTemplateContext {
  state: LeadState;
  channel: "EMAIL" | "SMS";
  firstName: string;
  intent: LoanIntent;
  officerFirstName: string;
  senderName: string;
}

export interface OutreachTemplate {
  id: LeadState;
  label: string;
  subject?: string;
  body: string;
  sendable: boolean;
}

export const LEAD_STAGE_LABELS: Record<LeadState, string> = {
  NEW: "New inquiry",
  ATTEMPTING_CONTACT: "Trying to connect",
  IN_CONVERSATION: "Conversation in progress",
  QUALIFYING: "Confirming information",
  READY_FOR_HANDOFF: "Ready for an officer",
  ASSIGNED: "Officer assigned",
  ACKNOWLEDGED: "Officer follow-up",
  NURTURE: "Longer-term follow-up",
  STALE: "Re-engagement",
  SUPPRESSED: "Suppressed — no send",
  CLOSED_WON: "Completed customer follow-up",
  CLOSED_LOST: "Closed — no send",
};

export const LEAD_STAGE_TEMPLATE_IDS = Object.keys(LEAD_STAGE_LABELS) as LeadState[];

const intentLabel = (intent: LoanIntent) =>
  intent === "HOME_EQUITY" ? "home equity" : intent === "CASH_OUT" ? "cash-out refinance" : intent === "REFINANCE" ? "refinance" : "mortgage";

function messageForStage(state: LeadState, label: string): { subject: string; message: string; sendable: boolean } {
  switch (state) {
    case "NEW":
      return { subject: `We received your ${label} inquiry`, message: `Thanks for reaching out about ${label}. I can answer your questions and explain the next steps. What is the best time for a brief call?`, sendable: true };
    case "ATTEMPTING_CONTACT":
      return { subject: `A quick follow-up on your ${label} inquiry`, message: `I’m following up on the information you requested about ${label}. Reply with a convenient time and we’ll continue from there.`, sendable: true };
    case "IN_CONVERSATION":
      return { subject: `Continuing our ${label} conversation`, message: `Thanks for speaking with us. I have the information you already shared and can pick up where we left off. What question can I help with next?`, sendable: true };
    case "QUALIFYING":
      return { subject: `Next step for your ${label} inquiry`, message: `We have started reviewing the information you shared. A few confirmations may still be needed before a licensed loan officer can discuss available options. When can we finish those together?`, sendable: true };
    case "READY_FOR_HANDOFF":
      return { subject: `Your licensed loan officer is ready`, message: `Your initial information is organized and ready for a licensed loan officer. Reply with a convenient time for the next conversation.`, sendable: true };
    case "ASSIGNED":
      return { subject: `Your Equity Flow Group contact`, message: `I’m the contact assigned to your ${label} inquiry and I have the information you already shared. Send me your current question or a good callback time.`, sendable: true };
    case "ACKNOWLEDGED":
      return { subject: `Following up as promised`, message: `I’m following up on your ${label} inquiry and am ready to continue from our earlier conversation. What would be most helpful to cover next?`, sendable: true };
    case "NURTURE":
      return { subject: `Here when the timing is right`, message: `I wanted to keep the door open on your ${label} inquiry. If your timing or questions have changed, reply here and we can revisit the next step.`, sendable: true };
    case "STALE":
      return { subject: `Should we keep your ${label} inquiry open?`, message: `We haven’t connected recently about your ${label} inquiry. Reply if you would like to continue, and we’ll use the information already on file rather than start over.`, sendable: true };
    case "CLOSED_WON":
      return { subject: `Checking in from Equity Flow Group`, message: `Thank you for working with Equity Flow Group. If you have a follow-up question about your completed process, reply here and we’ll direct it to the right person.`, sendable: true };
    case "SUPPRESSED":
      return { subject: "Contact is suppressed", message: "This lead has opted out or is otherwise suppressed. No message may be sent until an authorized review changes that status.", sendable: false };
    case "CLOSED_LOST":
      return { subject: "Lead is closed", message: "This lead is closed and has no active outreach template. Reopen it through the approved workflow before contacting the borrower.", sendable: false };
  }
}

export function renderLeadStageTemplate(context: OutreachTemplateContext): OutreachTemplate {
  const label = intentLabel(context.intent);
  const stage = messageForStage(context.state, label);
  if (!stage.sendable) return { id: context.state, label: LEAD_STAGE_LABELS[context.state], subject: stage.subject, body: stage.message, sendable: false };

  if (context.channel === "SMS") {
    const body = `Hi ${context.firstName}, it’s ${context.officerFirstName} at ${context.senderName}. ${stage.message} Reply STOP to opt out.`;
    return { id: context.state, label: LEAD_STAGE_LABELS[context.state], body: body.slice(0, 320), sendable: true };
  }

  return {
    id: context.state,
    label: LEAD_STAGE_LABELS[context.state],
    subject: stage.subject,
    body: `Hi ${context.firstName},\n\n${stage.message}\n\nBest,\n${context.officerFirstName}\n${context.senderName}`,
    sendable: true,
  };
}
