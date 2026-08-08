import { nanoid } from "nanoid";
import { hashPasswordSync } from "@/core/auth";
import type { Database } from "@/domain/store";
import { STATE_TIMEZONE } from "@/domain/stateTimezone";
import type {
  CadencePlan,
  Channel,
  ConsentRecord,
  ContactAttempt,
  ConversationSession,
  DisclosureVersion,
  FieldCandidate,
  Lead,
  LeadEvent,
  LeadField,
  LeadState,
  Note,
  Officer,
  Person,
  PolicyDecision,
  Suppression,
  Task,
  User,
} from "@/domain/types";

function id(prefix: string) {
  return `${prefix}_${nanoid(10)}`;
}

function minutesAgo(n: number, from: Date) {
  return new Date(from.getTime() - n * 60_000).toISOString();
}
function hoursAgo(n: number, from: Date) {
  return new Date(from.getTime() - n * 3_600_000).toISOString();
}
function daysAgo(n: number, from: Date) {
  return new Date(from.getTime() - n * 86_400_000).toISOString();
}
function minutesFromNow(n: number, from: Date) {
  return new Date(from.getTime() + n * 60_000).toISOString();
}

const DISCLOSURE_TEXT_TCPA_SMS =
  "By checking this box, I consent to receive text messages from Equity Flow Group and its licensed partners about my refinance or home equity inquiry, including messages sent using an automatic telephone dialing system. Message and data rates may apply. Consent is not a condition of purchase. Reply STOP to opt out at any time, HELP for help.";

const DISCLOSURE_TEXT_TCPA_VOICE =
  "By checking this box, I consent to receive phone calls from Equity Flow Group and its licensed partners about my refinance or home equity inquiry, including calls made using an automatic telephone dialing system or an artificial or prerecorded voice. Consent is not a condition of purchase.";

const DISCLOSURE_TEXT_RECORDING =
  "This call may be recorded and may include an AI voice assistant for quality and compliance purposes. You may request a human representative at any time.";

const DISCLOSURE_TEXT_EMAIL =
  "By checking this box, I consent to receive email communications from Equity Flow Group about my inquiry.";

const DISCLOSURE_TEXT_FCRA =
  "Submitting this form does not authorize a credit report or credit score pull, and does not affect your credit score. If you move forward with a licensed loan officer and formally apply, they may obtain your credit report or score in connection with that application. Under the Fair Credit Reporting Act (FCRA), you have the right to know what is in your credit file, to dispute incomplete or inaccurate information with the consumer reporting agency, and to obtain a copy of your credit report. Learn more at consumerfinance.gov/learnmore.";

export function seedDatabase(db: Database) {
  const now = new Date();

  // ---- Disclosure versions ----------------------------------------------
  const disclosures: DisclosureVersion[] = [
    {
      id: "disc_tcpa_sms_v3",
      key: "tcpa_sms_v3",
      version: 3,
      bodyText: DISCLOSURE_TEXT_TCPA_SMS,
      effectiveFrom: daysAgo(120, now),
      approvedBy: "Dana Whitfield (Compliance)",
      approvedAt: daysAgo(120, now),
      status: "APPROVED",
    },
    {
      id: "disc_tcpa_voice_v2",
      key: "tcpa_voice_v2",
      version: 2,
      bodyText: DISCLOSURE_TEXT_TCPA_VOICE,
      effectiveFrom: daysAgo(200, now),
      approvedBy: "Dana Whitfield (Compliance)",
      approvedAt: daysAgo(200, now),
      status: "APPROVED",
    },
    {
      id: "disc_recording_v1",
      key: "recording_v1",
      version: 1,
      bodyText: DISCLOSURE_TEXT_RECORDING,
      effectiveFrom: daysAgo(200, now),
      approvedBy: "Dana Whitfield (Compliance)",
      approvedAt: daysAgo(200, now),
      status: "APPROVED",
    },
    {
      id: "disc_email_v1",
      key: "email_v1",
      version: 1,
      bodyText: DISCLOSURE_TEXT_EMAIL,
      effectiveFrom: daysAgo(200, now),
      approvedBy: "Dana Whitfield (Compliance)",
      approvedAt: daysAgo(200, now),
      status: "APPROVED",
    },
    {
      id: "disc_fcra_v1",
      key: "fcra_v1",
      version: 1,
      bodyText: DISCLOSURE_TEXT_FCRA,
      effectiveFrom: daysAgo(200, now),
      approvedBy: "Dana Whitfield (Compliance)",
      approvedAt: daysAgo(200, now),
      status: "APPROVED",
    },
  ];
  disclosures.forEach((d) => db.disclosures.set(d.id, d));

  // ---- Officers -----------------------------------------------------------
  const officers: Officer[] = [
    {
      id: "off_1",
      userId: "user_officer_1",
      name: "Marcus Chen",
      email: "marcus.chen@mortgageleadhub.com",
      nmlsId: "NMLS-884213",
      licensedStates: ["TX", "CO", "AZ", "GA"],
      productTypes: ["REFINANCE", "CASH_OUT", "HOME_EQUITY"],
      dailyCapacity: 12,
      currentLoad: 4,
      activeHoursStart: 8,
      activeHoursEnd: 18,
      isActive: true,
    },
    {
      id: "off_2",
      userId: "user_officer_2",
      name: "Priya Raman",
      email: "priya.raman@mortgageleadhub.com",
      nmlsId: "NMLS-991042",
      licensedStates: ["CA", "OR", "WA", "NV"],
      productTypes: ["REFINANCE", "HOME_EQUITY"],
      dailyCapacity: 10,
      currentLoad: 6,
      activeHoursStart: 8,
      activeHoursEnd: 17,
      isActive: true,
    },
    {
      id: "off_3",
      userId: "user_officer_3",
      name: "Dave Kowalski",
      email: "dave.kowalski@mortgageleadhub.com",
      nmlsId: "NMLS-773310",
      licensedStates: ["NY", "PA", "OH", "NC", "FL"],
      productTypes: ["REFINANCE", "CASH_OUT", "HOME_EQUITY"],
      dailyCapacity: 14,
      currentLoad: 9,
      activeHoursStart: 9,
      activeHoursEnd: 19,
      isActive: true,
    },
  ];
  officers.forEach((o) => db.officers.set(o.id, o));

  // ---- Users (demo login identities, one per role) -------------------------
  // Demo-only password, same across every seeded account — change these in
  // any real deployment (see DEPLOY.md). Real users created via Admin get a
  // proper email invite link instead (domain/actions.ts createUserAction).
  const DEMO_PASSWORD_HASH = hashPasswordSync("MlhDemo#2026");
  const users: User[] = [
    { id: "user_admin", name: "Anubhav (Admin)", email: "newanubhav.4@gmail.com", role: "ADMIN", isActive: true, passwordHash: DEMO_PASSWORD_HASH },
    { id: "user_compliance", name: "Dana Whitfield", email: "dana.whitfield@mortgageleadhub.com", role: "COMPLIANCE", isActive: true, passwordHash: DEMO_PASSWORD_HASH },
    { id: "user_officer_1", name: "Marcus Chen", email: "marcus.chen@mortgageleadhub.com", role: "OFFICER", officerId: "off_1", isActive: true, passwordHash: DEMO_PASSWORD_HASH },
    { id: "user_readonly", name: "Investor View", email: "investor@mortgageleadhub.com", role: "READ_ONLY", isActive: true, passwordHash: DEMO_PASSWORD_HASH },
  ];
  users.forEach((u) => db.users.set(u.id, u));
  console.log(
    `\n[Equity Flow Group] Seeded demo accounts (password for all: "MlhDemo#2026" — change in any real deployment):\n  ${users.map((u) => `${u.email} (${u.role})`).join("\n  ")}\n`
  );

  // ---- Cadence plans --------------------------------------------------------
  const cadencePlans: CadencePlan[] = [
    {
      id: "cadence_default",
      name: "Default cadence",
      isDefault: true,
      steps: [
        { offsetMinutes: 0, channel: "VOICE", maxAttempts: 1, stopOnOutcomes: ["ANSWERED"] },
        { offsetMinutes: 120, channel: "SMS", maxAttempts: 1, stopOnOutcomes: [] },
        { offsetMinutes: 1440, channel: "VOICE", maxAttempts: 1, stopOnOutcomes: ["ANSWERED"] },
        { offsetMinutes: 4320, channel: "VOICE", maxAttempts: 1, stopOnOutcomes: ["ANSWERED"] },
        { offsetMinutes: 4320, channel: "SMS", maxAttempts: 1, stopOnOutcomes: [] },
        { offsetMinutes: 10080, channel: "EMAIL", maxAttempts: 1, stopOnOutcomes: [] },
      ],
    },
    {
      id: "cadence_ca_refi",
      name: "California refinance cadence",
      stateCode: "CA",
      intent: "REFINANCE",
      isDefault: false,
      steps: [
        { offsetMinutes: 0, channel: "VOICE", maxAttempts: 1, stopOnOutcomes: ["ANSWERED"] },
        { offsetMinutes: 60, channel: "SMS", maxAttempts: 1, stopOnOutcomes: [] },
        { offsetMinutes: 1440, channel: "VOICE", maxAttempts: 1, stopOnOutcomes: ["ANSWERED"] },
      ],
    },
  ];
  cadencePlans.forEach((c) => db.cadencePlans.set(c.id, c));

  // ---- Kill switch ----------------------------------------------------------
  db.killSwitch = { isOn: false };

  // -------------------------------------------------------------------------
  // Lead builder helpers
  // -------------------------------------------------------------------------

  let eventCorrelationSeq = 0;
  function pushEvent(leadId: string, partial: Omit<LeadEvent, "id" | "leadId" | "correlationId" | "recordedAt">) {
    eventCorrelationSeq += 1;
    db.events.push({
      id: id("evt"),
      leadId,
      correlationId: `corr_${eventCorrelationSeq}`,
      recordedAt: partial.occurredAt,
      ...partial,
    });
  }

  interface SeedLeadOptions {
    firstName: string;
    lastName: string;
    phone: string;
    email: string;
    stateCode: string;
    city: string;
    intent: Lead["intent"];
    goal: Lead["goal"];
    timeline: Lead["timeline"];
    creditRange: Lead["creditRange"];
    occupancy: Lead["occupancy"];
    estimatedValue?: number;
    currentBalance?: number;
    state: LeadState;
    createdMinutesAgo: number;
    assignedOfficerId?: string;
    voiceConsent?: boolean;
    smsConsent?: boolean;
    emailConsent?: boolean;
    recordingConsent?: boolean;
  }

  function seedLead(opts: SeedLeadOptions): Lead {
    const leadId = id("lead");
    const personId = id("person");
    const publicRef = nanoid(10);
    const createdAt = minutesAgo(opts.createdMinutesAgo, now);
    const timezone = STATE_TIMEZONE[opts.stateCode] ?? "UNKNOWN";

    const person: Person = {
      id: personId,
      leadId,
      role: "PRIMARY",
      firstName: opts.firstName,
      lastName: opts.lastName,
      phoneE164: opts.phone,
      email: opts.email,
      preferredContactWindow: "ANY",
      timezone,
    };
    db.people.set(personId, person);

    const consentDefs: { scope: ConsentRecord["scope"]; granted: boolean; disclosureVersionId: string }[] = [
      { scope: "CONTACT_VOICE", granted: opts.voiceConsent ?? true, disclosureVersionId: "disc_tcpa_voice_v2" },
      { scope: "CONTACT_SMS", granted: opts.smsConsent ?? true, disclosureVersionId: "disc_tcpa_sms_v3" },
      { scope: "CONTACT_EMAIL", granted: opts.emailConsent ?? true, disclosureVersionId: "disc_email_v1" },
      { scope: "RECORDING", granted: opts.recordingConsent ?? true, disclosureVersionId: "disc_recording_v1" },
    ];
    for (const c of consentDefs) {
      const rec: ConsentRecord = {
        id: id("consent"),
        leadId,
        personId,
        scope: c.scope,
        granted: c.granted,
        disclosureVersionId: c.disclosureVersionId,
        exactTextSnapshot: db.disclosures.get(c.disclosureVersionId)?.bodyText ?? "",
        capturedAt: createdAt,
        sourceUrl: "https://apply.mortgageleadhub.com/intake",
        ipAddress: "203.0.113.42",
        userAgent: "Mozilla/5.0 (compatible demo UA)",
        sessionId: id("sess"),
        formFingerprint: id("fp"),
      };
      db.consents.push(rec);
    }

    const lead: Lead = {
      id: leadId,
      publicRef,
      state: opts.state,
      intent: opts.intent,
      goal: opts.goal,
      timeline: opts.timeline,
      creditRange: opts.creditRange,
      sourceId: "web_organic",
      stateCode: opts.stateCode,
      city: opts.city,
      occupancy: opts.occupancy,
      estimatedValue: opts.estimatedValue,
      currentBalance: opts.currentBalance,
      assignedOfficerId: opts.assignedOfficerId,
      cadencePlanVersionId: opts.stateCode === "CA" && opts.intent === "REFINANCE" ? "cadence_ca_refi" : "cadence_default",
      slaDueAt: minutesFromNow(5 - opts.createdMinutesAgo, now),
      completenessScore: 0,
      createdAt,
      updatedAt: createdAt,
      attemptsToday: 0,
      attemptsTotal: 0,
      lastAttemptAt: null,
    };
    db.leads.set(leadId, lead);

    pushEvent(leadId, {
      type: "LEAD_CREATED",
      actorType: "BORROWER",
      occurredAt: createdAt,
      payload: { intent: opts.intent, goal: opts.goal },
    });

    const task: Task = {
      id: id("task"),
      leadId,
      type: "FIRST_CONTACT",
      dueAt: lead.slaDueAt,
      status: "OPEN",
      title: "First contact attempt due",
    };
    db.tasks.set(task.id, task);

    return lead;
  }

  function addAttempt(
    lead: Lead,
    channel: Channel,
    outcome: ContactAttempt["outcome"],
    attemptNumber: number,
    minsAgo: number,
    blockedReason?: string
  ) {
    const decisionId = id("policy");
    const decision: PolicyDecision = {
      id: decisionId,
      leadId: lead.id,
      channel,
      decision: outcome === "BLOCKED" ? "DENY" : "ALLOW",
      reasons: outcome === "BLOCKED" ? [blockedReason as never] : ["ALLOW"],
      evaluatedAt: minutesAgo(minsAgo, now),
      inputSnapshot: { channel, attemptNumber },
    };
    db.policyDecisions.push(decision);

    const attempt: ContactAttempt = {
      id: id("attempt"),
      leadId: lead.id,
      channel,
      direction: "OUTBOUND",
      idempotencyKey: id("idem"),
      policyDecisionId: decisionId,
      providerMessageId: outcome === "BLOCKED" ? undefined : id("prov"),
      outcome,
      attemptNumber,
      scheduledFor: minutesAgo(minsAgo, now),
      startedAt: minutesAgo(minsAgo, now),
      endedAt: minutesAgo(minsAgo - 1, now),
      blockedReason,
    };
    db.attempts.push(attempt);

    pushEvent(lead.id, {
      type: outcome === "BLOCKED" ? "OUTREACH_BLOCKED" : "OUTREACH_ATTEMPTED",
      actorType: "SYSTEM",
      channel,
      occurredAt: minutesAgo(minsAgo, now),
      payload: { outcome, attemptNumber, reasons: decision.reasons },
    });

    if (outcome !== "BLOCKED") {
      lead.attemptsTotal += 1;
      lead.attemptsToday += 1;
      lead.lastAttemptAt = minutesAgo(minsAgo, now);
      if (!lead.firstContactAt) lead.firstContactAt = minutesAgo(minsAgo, now);
      lead.lastContactAt = minutesAgo(minsAgo, now);
    }
  }

  function addNote(leadId: string, authorId: string, authorName: string, body: string, minsAgo: number) {
    const note: Note = { id: id("note"), leadId, authorId, authorName, body, createdAt: minutesAgo(minsAgo, now) };
    db.notes.push(note);
  }

  function setField(
    leadId: string,
    fieldPath: string,
    value: unknown,
    status: LeadField["status"],
    confidence: number,
    sourceType: LeadField["sourceType"],
    minsAgo: number,
    conflictingValue?: unknown
  ) {
    const key = `${leadId}:${fieldPath}`;
    db.leadFields.set(key, {
      id: id("field"),
      leadId,
      fieldPath,
      value,
      status,
      confidence,
      sourceType,
      collectedAt: minutesAgo(minsAgo, now),
      verificationStatus: "UNVERIFIED",
      supersededCandidateIds: [],
      conflictingValue,
    });
  }

  function addCandidate(
    leadId: string,
    fieldPath: string,
    value: unknown,
    confidence: number,
    turnRefs: number[],
    promoted: boolean,
    minsAgo: number
  ) {
    const cand: FieldCandidate = {
      id: id("cand"),
      leadId,
      fieldPath,
      value,
      confidence,
      sourceType: "BORROWER_STATED",
      transcriptTurnRefs: turnRefs,
      createdAt: minutesAgo(minsAgo, now),
      promoted,
      promotionRuleCode: promoted ? "CONFIDENCE_HIGH" : undefined,
    };
    db.fieldCandidates.push(cand);
  }

  function computeAndSetCompleteness(lead: Lead) {
    const weights: Record<string, number> = {
      "contact.reachable": 20,
      "loan.intent": 15,
      "property.identified": 15,
      "property.occupancy": 10,
      "loan.purpose": 10,
      "borrower.timeline": 10,
      "borrower.creditBand": 10,
      "borrower.incomeBand": 10,
    };
    let score = 0;
    for (const [path, weight] of Object.entries(weights)) {
      const f = db.leadFields.get(`${lead.id}:${path}`);
      if (f && (f.status === "CONFIRMED" || f.status === "VERIFIED" || f.status === "CANDIDATE")) {
        score += weight;
      }
    }
    lead.completenessScore = score;
  }

  // -------------------------------------------------------------------------
  // 1) NEW — just submitted, SLA countdown running
  // -------------------------------------------------------------------------
  seedLead({
    firstName: "Jordan",
    lastName: "Ellis",
    phone: "+14695550142",
    email: "jordan.ellis@example.com",
    stateCode: "TX",
    city: "Plano",
    intent: "REFINANCE",
    goal: "LOWER_PAYMENT",
    timeline: "1_3_MONTHS",
    creditRange: "GOOD_680_739",
    occupancy: "PRIMARY",
    estimatedValue: 415000,
    currentBalance: 298000,
    state: "NEW",
    createdMinutesAgo: 3,
  });

  // -------------------------------------------------------------------------
  // 2) ATTEMPTING_CONTACT — first voice attempt no-answer, SMS fallback sent
  // -------------------------------------------------------------------------
  {
    const lead = seedLead({
      firstName: "Priya",
      lastName: "Natarajan",
      phone: "+17205550118",
      email: "priya.n@example.com",
      stateCode: "CO",
      city: "Aurora",
      intent: "CASH_OUT",
      goal: "DEBT_CONSOLIDATION",
      timeline: "ASAP",
      creditRange: "FAIR_620_679",
      occupancy: "PRIMARY",
      estimatedValue: 512000,
      currentBalance: 340000,
      state: "ATTEMPTING_CONTACT",
      createdMinutesAgo: 47,
    });
    addAttempt(lead, "VOICE", "NO_ANSWER", 1, 40);
    addAttempt(lead, "SMS", "DELIVERED", 1, 38);
    setField(lead.id, "contact.reachable", true, "CANDIDATE", 0.7, "FORM", 40);
    computeAndSetCompleteness(lead);
  }

  // -------------------------------------------------------------------------
  // 3) IN_CONVERSATION — currently mid qualifying call
  // -------------------------------------------------------------------------
  {
    const lead = seedLead({
      firstName: "Miguel",
      lastName: "Santos",
      phone: "+19495550176",
      email: "miguel.santos@example.com",
      stateCode: "CA",
      city: "Irvine",
      intent: "REFINANCE",
      goal: "SHORTEN_TERM",
      timeline: "3_6_MONTHS",
      creditRange: "EXCELLENT_740_PLUS",
      occupancy: "PRIMARY",
      estimatedValue: 890000,
      currentBalance: 520000,
      state: "IN_CONVERSATION",
      createdMinutesAgo: 22,
    });
    addAttempt(lead, "VOICE", "ANSWERED", 1, 12);
    pushEvent(lead.id, { type: "CONTACT_ANSWERED", actorType: "BORROWER", channel: "VOICE", occurredAt: minutesAgo(12, now) });
    const conv: ConversationSession = {
      id: id("conv"),
      leadId: lead.id,
      contactAttemptId: db.attempts[db.attempts.length - 1].id,
      promptVersionId: "prompt_qualify_v4",
      channel: "VOICE",
      status: "IN_PROGRESS",
      startedAt: minutesAgo(12, now),
      escalated: false,
      redactionApplied: false,
      transcript: [
        { turn: 1, role: "AGENT", text: "Hi, this is Alex calling on behalf of Equity Flow Group about your refinance inquiry — is now an okay time?", at: minutesAgo(12, now) },
        { turn: 2, role: "BORROWER", text: "Yeah, sure, go ahead.", at: minutesAgo(11, now) },
        { turn: 3, role: "AGENT", text: "Great — just confirming, is this Miguel?", at: minutesAgo(11, now) },
        { turn: 4, role: "BORROWER", text: "That's me.", at: minutesAgo(11, now) },
        { turn: 5, role: "AGENT", text: "Thanks. What's the main thing you're hoping to get out of a refinance right now?", at: minutesAgo(10, now) },
        { turn: 6, role: "BORROWER", text: "Honestly just want to shorten the term, we're on a 30 year and want to knock it down.", at: minutesAgo(10, now) },
      ],
      summary: undefined,
    };
    db.conversations.set(conv.id, conv);
    setField(lead.id, "contact.reachable", true, "CONFIRMED", 0.95, "BORROWER_STATED", 11);
    setField(lead.id, "loan.intent", "REFINANCE", "CONFIRMED", 0.95, "FORM", 22);
    setField(lead.id, "loan.purpose", "SHORTEN_TERM", "CONFIRMED", 0.9, "BORROWER_STATED", 10);
    computeAndSetCompleteness(lead);
  }

  // -------------------------------------------------------------------------
  // 4) QUALIFYING — conversation completed, extraction in progress
  // -------------------------------------------------------------------------
  {
    const lead = seedLead({
      firstName: "Angela",
      lastName: "Brooks",
      phone: "+19045550133",
      email: "angela.brooks@example.com",
      stateCode: "FL",
      city: "Jacksonville",
      intent: "HOME_EQUITY",
      goal: "CASH_OUT",
      timeline: "1_3_MONTHS",
      creditRange: "GOOD_680_739",
      occupancy: "PRIMARY",
      estimatedValue: 375000,
      currentBalance: 210000,
      state: "QUALIFYING",
      createdMinutesAgo: 130,
    });
    addAttempt(lead, "VOICE", "ANSWERED", 1, 95);
    pushEvent(lead.id, { type: "CONTACT_ANSWERED", actorType: "BORROWER", channel: "VOICE", occurredAt: minutesAgo(95, now) });
    pushEvent(lead.id, { type: "CONVERSATION_COMPLETED", actorType: "SYSTEM", occurredAt: minutesAgo(80, now) });
    pushEvent(lead.id, { type: "FIELDS_EXTRACTED", actorType: "SYSTEM", occurredAt: minutesAgo(78, now), payload: { fieldCount: 6 } });
    setField(lead.id, "contact.reachable", true, "CONFIRMED", 0.95, "BORROWER_STATED", 95);
    setField(lead.id, "loan.intent", "HOME_EQUITY", "CONFIRMED", 0.95, "FORM", 130);
    setField(lead.id, "property.identified", true, "CONFIRMED", 0.9, "FORM", 130);
    setField(lead.id, "property.occupancy", "PRIMARY", "CONFIRMED", 0.92, "BORROWER_STATED", 90);
    setField(lead.id, "loan.purpose", "CASH_OUT", "CONFIRMED", 0.88, "BORROWER_STATED", 88);
    setField(lead.id, "borrower.timeline", "1_3_MONTHS", "CONFIRMED", 0.85, "BORROWER_STATED", 86);
    addCandidate(lead.id, "borrower.creditBand", "GOOD_680_739", 0.72, [14], false, 82);
    addCandidate(lead.id, "borrower.incomeBand", "UNKNOWN", 0.4, [], false, 82);
    computeAndSetCompleteness(lead);
  }

  // -------------------------------------------------------------------------
  // 5) READY_FOR_HANDOFF — fully qualified, no eligible officer yet assigned
  // -------------------------------------------------------------------------
  {
    const lead = seedLead({
      firstName: "Thomas",
      lastName: "Reyes",
      phone: "+16145550187",
      email: "thomas.reyes@example.com",
      stateCode: "OH",
      city: "Columbus",
      intent: "REFINANCE",
      goal: "LOWER_PAYMENT",
      timeline: "ASAP",
      creditRange: "GOOD_680_739",
      occupancy: "PRIMARY",
      estimatedValue: 320000,
      currentBalance: 260000,
      state: "READY_FOR_HANDOFF",
      createdMinutesAgo: 260,
    });
    addAttempt(lead, "VOICE", "ANSWERED", 1, 210);
    pushEvent(lead.id, { type: "CONTACT_ANSWERED", actorType: "BORROWER", channel: "VOICE", occurredAt: minutesAgo(210, now) });
    pushEvent(lead.id, { type: "CONVERSATION_COMPLETED", actorType: "SYSTEM", occurredAt: minutesAgo(180, now) });
    pushEvent(lead.id, { type: "FIELDS_EXTRACTED", actorType: "SYSTEM", occurredAt: minutesAgo(178, now) });
    pushEvent(lead.id, { type: "PACKAGE_READY", actorType: "SYSTEM", occurredAt: minutesAgo(175, now) });
    setField(lead.id, "contact.reachable", true, "CONFIRMED", 0.95, "BORROWER_STATED", 210);
    setField(lead.id, "loan.intent", "REFINANCE", "CONFIRMED", 0.95, "FORM", 260);
    setField(lead.id, "property.identified", true, "CONFIRMED", 0.9, "FORM", 260);
    setField(lead.id, "property.occupancy", "PRIMARY", "CONFIRMED", 0.9, "BORROWER_STATED", 200);
    setField(lead.id, "loan.purpose", "LOWER_PAYMENT", "CONFIRMED", 0.88, "BORROWER_STATED", 198);
    setField(lead.id, "borrower.timeline", "ASAP", "CONFIRMED", 0.9, "BORROWER_STATED", 196);
    setField(lead.id, "borrower.creditBand", "GOOD_680_739", "CONFIRMED", 0.87, "BORROWER_STATED", 195);
    setField(lead.id, "borrower.incomeBand", "UNKNOWN", "UNKNOWN", 0, "BORROWER_STATED", 195);
    computeAndSetCompleteness(lead);
    const t: Task = {
      id: id("task"),
      leadId: lead.id,
      type: "REVIEW_MISSING_FIELDS",
      dueAt: minutesFromNow(60, now),
      status: "OPEN",
      title: "No eligible officer — needs manual routing",
    };
    db.tasks.set(t.id, t);
  }

  // -------------------------------------------------------------------------
  // 6) ASSIGNED — hero lead, rich detail, pending acknowledgement
  // -------------------------------------------------------------------------
  {
    const lead = seedLead({
      firstName: "Sarah",
      lastName: "Whitfield",
      phone: "+12145550199",
      email: "sarah.whitfield@example.com",
      stateCode: "TX",
      city: "Dallas",
      intent: "CASH_OUT",
      goal: "DEBT_CONSOLIDATION",
      timeline: "ASAP",
      creditRange: "GOOD_680_739",
      occupancy: "PRIMARY",
      estimatedValue: 468000,
      currentBalance: 275000,
      state: "ASSIGNED",
      createdMinutesAgo: 340,
      assignedOfficerId: "off_1",
    });
    addAttempt(lead, "VOICE", "ANSWERED", 1, 300);
    const attemptId = db.attempts[db.attempts.length - 1].id;
    pushEvent(lead.id, { type: "CONTACT_ANSWERED", actorType: "BORROWER", channel: "VOICE", occurredAt: minutesAgo(300, now) });

    const conv: ConversationSession = {
      id: id("conv"),
      leadId: lead.id,
      contactAttemptId: attemptId,
      promptVersionId: "prompt_qualify_v4",
      channel: "VOICE",
      status: "COMPLETED",
      startedAt: minutesAgo(300, now),
      endedAt: minutesAgo(288, now),
      escalated: false,
      redactionApplied: true,
      summary:
        "Borrower wants to consolidate ~$28k of credit card debt via cash-out refi. Primary residence, stable W-2 income (band only). No hardship indicators. Prefers evening callback.",
      transcript: [
        { turn: 1, role: "AGENT", text: "Hi, this is Alex from Equity Flow Group calling about the inquiry you submitted online — is this Sarah?", at: minutesAgo(300, now) },
        { turn: 2, role: "BORROWER", text: "Yes, this is Sarah.", at: minutesAgo(299, now) },
        { turn: 3, role: "AGENT", text: "Perfect. Just so you know, this call may be recorded, and you can ask for a human at any time. What's the main reason you're looking into this?", at: minutesAgo(299, now) },
        { turn: 4, role: "BORROWER", text: "I've got some credit card debt piling up, I wanted to see about pulling equity out to pay it down.", at: minutesAgo(298, now) },
        { turn: 5, role: "AGENT", text: "Got it — do you currently live at the property on file, and is it your primary residence?", at: minutesAgo(296, now) },
        { turn: 6, role: "BORROWER", text: "Yep, primary residence, been here 6 years.", at: minutesAgo(296, now) },
        { turn: 7, role: "AGENT", text: "Roughly how much are you hoping to access, and what's the balance on your current mortgage?", at: minutesAgo(294, now) },
        { turn: 8, role: "BORROWER", text: "Maybe 28 thousand to clear the cards, and I think I owe around 275 on the house.", at: minutesAgo(293, now) },
        { turn: 9, role: "AGENT", text: "How soon are you hoping to move on this?", at: minutesAgo(291, now) },
        { turn: 10, role: "BORROWER", text: "As soon as possible honestly, the interest on the cards is brutal.", at: minutesAgo(291, now) },
        { turn: 11, role: "AGENT", text: "Understood. Just a rough range — is your income better described as steady W-2, self-employed, or mixed?", at: minutesAgo(289, now) },
        { turn: 12, role: "BORROWER", text: "Steady W-2, same job for 5 years.", at: minutesAgo(289, now) },
        { turn: 13, role: "AGENT", text: "And for your credit, would you say excellent, good, fair, or below 620 — just a band, not a pull.", at: minutesAgo(288, now) },
        { turn: 14, role: "BORROWER", text: "Probably good, like high 600s to low 700s.", at: minutesAgo(288, now) },
        { turn: 15, role: "AGENT", text: "Last one, totally optional — any recent bankruptcy, foreclosure, or late payments? You can skip this.", at: minutesAgo(288, now) },
        { turn: 16, role: "BORROWER", text: "No, nothing like that.", at: minutesAgo(288, now) },
        { turn: 17, role: "AGENT", text: "Great, that's everything I need. A licensed officer will follow up, best time to reach you?", at: minutesAgo(288, now) },
        { turn: 18, role: "BORROWER", text: "Evenings after 6 work best.", at: minutesAgo(288, now) },
      ],
    };
    db.conversations.set(conv.id, conv);
    pushEvent(lead.id, { type: "CONVERSATION_COMPLETED", actorType: "SYSTEM", channel: "VOICE", occurredAt: minutesAgo(288, now) });
    pushEvent(lead.id, { type: "FIELDS_EXTRACTED", actorType: "SYSTEM", occurredAt: minutesAgo(286, now), payload: { fieldCount: 8 } });
    pushEvent(lead.id, { type: "PACKAGE_READY", actorType: "SYSTEM", occurredAt: minutesAgo(280, now) });
    pushEvent(lead.id, {
      type: "OFFICER_ASSIGNED",
      actorType: "SYSTEM",
      actorName: "Routing engine",
      occurredAt: minutesAgo(275, now),
      payload: { officerId: "off_1", officerName: "Marcus Chen" },
    });

    setField(lead.id, "contact.reachable", true, "CONFIRMED", 0.97, "BORROWER_STATED", 299);
    setField(lead.id, "loan.intent", "CASH_OUT", "CONFIRMED", 0.95, "FORM", 340);
    setField(lead.id, "property.identified", true, "CONFIRMED", 0.9, "FORM", 340);
    setField(lead.id, "property.occupancy", "PRIMARY", "CONFIRMED", 0.93, "BORROWER_STATED", 296);
    setField(lead.id, "loan.purpose", "DEBT_CONSOLIDATION", "CONFIRMED", 0.9, "BORROWER_STATED", 293);
    setField(lead.id, "borrower.timeline", "ASAP", "CONFIRMED", 0.91, "BORROWER_STATED", 291);
    setField(lead.id, "borrower.creditBand", "GOOD_680_739", "CANDIDATE", 0.68, "BORROWER_STATED", 288);
    setField(lead.id, "borrower.incomeBand", "W2_STEADY", "CONFIRMED", 0.86, "BORROWER_STATED", 289);
    addCandidate(lead.id, "borrower.creditBand", "GOOD_680_739", 0.68, [14], false, 286);
    addCandidate(lead.id, "loan.desiredCashOut", 28000, 0.9, [8], true, 286);
    computeAndSetCompleteness(lead);

    const ackTask: Task = {
      id: id("task"),
      leadId: lead.id,
      type: "ACKNOWLEDGE_HANDOFF",
      assigneeId: "off_1",
      dueAt: minutesFromNow(45, now),
      status: "OPEN",
      title: "Acknowledge handoff for Sarah Whitfield",
    };
    db.tasks.set(ackTask.id, ackTask);

    addNote(lead.id, "user_officer_1", "Marcus Chen", "Reviewed package — looks clean, will call this evening per borrower's preference.", 30);
  }

  // -------------------------------------------------------------------------
  // 7) ACKNOWLEDGED — hero lead #2, automation halted, officer owns it, has a
  //    CONFLICTED field to demonstrate F-06 conflict handling
  // -------------------------------------------------------------------------
  {
    const lead = seedLead({
      firstName: "David",
      lastName: "Okafor",
      phone: "+17165550164",
      email: "david.okafor@example.com",
      stateCode: "NY",
      city: "Buffalo",
      intent: "REFINANCE",
      goal: "LOWER_PAYMENT",
      timeline: "3_6_MONTHS",
      creditRange: "EXCELLENT_740_PLUS",
      occupancy: "INVESTMENT",
      estimatedValue: 610000,
      currentBalance: 402000,
      state: "ACKNOWLEDGED",
      createdMinutesAgo: 2880,
      assignedOfficerId: "off_3",
    });
    addAttempt(lead, "VOICE", "ANSWERED", 1, 2820);
    pushEvent(lead.id, { type: "CONTACT_ANSWERED", actorType: "BORROWER", channel: "VOICE", occurredAt: minutesAgo(2820, now) });
    pushEvent(lead.id, { type: "CONVERSATION_COMPLETED", actorType: "SYSTEM", occurredAt: minutesAgo(2800, now) });
    pushEvent(lead.id, { type: "FIELDS_EXTRACTED", actorType: "SYSTEM", occurredAt: minutesAgo(2795, now) });
    pushEvent(lead.id, { type: "PACKAGE_READY", actorType: "SYSTEM", occurredAt: minutesAgo(2790, now) });
    pushEvent(lead.id, {
      type: "OFFICER_ASSIGNED",
      actorType: "SYSTEM",
      occurredAt: minutesAgo(2780, now),
      payload: { officerId: "off_3", officerName: "Dave Kowalski" },
    });
    pushEvent(lead.id, {
      type: "OFFICER_ACKNOWLEDGED",
      actorType: "OFFICER",
      actorId: "off_3",
      actorName: "Dave Kowalski",
      occurredAt: minutesAgo(2700, now),
    });

    setField(lead.id, "contact.reachable", true, "CONFIRMED", 0.95, "BORROWER_STATED", 2820);
    setField(lead.id, "loan.intent", "REFINANCE", "CONFIRMED", 0.95, "FORM", 2880);
    setField(lead.id, "property.identified", true, "CONFIRMED", 0.9, "FORM", 2880);
    // Form said PRIMARY, conversation said INVESTMENT — CONFLICTED per F-06.
    setField(lead.id, "property.occupancy", "PRIMARY", "CONFLICTED", 0.8, "FORM", 2880, "INVESTMENT");
    setField(lead.id, "loan.purpose", "LOWER_PAYMENT", "CONFIRMED", 0.88, "BORROWER_STATED", 2795);
    setField(lead.id, "borrower.timeline", "3_6_MONTHS", "CONFIRMED", 0.85, "BORROWER_STATED", 2793);
    setField(lead.id, "borrower.creditBand", "EXCELLENT_740_PLUS", "CONFIRMED", 0.9, "BORROWER_STATED", 2792);
    setField(lead.id, "borrower.incomeBand", "SELF_EMPLOYED", "CONFIRMED", 0.82, "BORROWER_STATED", 2791);
    computeAndSetCompleteness(lead);

    addNote(lead.id, "user_officer_3", "Dave Kowalski", "Confirmed with borrower directly — this is actually an investment property, form was filled out wrong. Correcting field.", 60);
  }

  // -------------------------------------------------------------------------
  // 8) NURTURE — max attempts reached on initial cadence, waiting on next step
  // -------------------------------------------------------------------------
  {
    const lead = seedLead({
      firstName: "Lena",
      lastName: "Kowalczyk",
      phone: "+13605550121",
      email: "lena.k@example.com",
      stateCode: "OH",
      city: "Toledo",
      intent: "REFINANCE",
      goal: "OTHER",
      timeline: "EXPLORING",
      creditRange: "UNSURE",
      occupancy: "PRIMARY",
      state: "NURTURE",
      createdMinutesAgo: 4200,
    });
    addAttempt(lead, "VOICE", "NO_ANSWER", 1, 4150);
    addAttempt(lead, "SMS", "DELIVERED", 1, 4020);
    addAttempt(lead, "VOICE", "NO_ANSWER", 2, 2700);
    pushEvent(lead.id, { type: "CADENCE_EXHAUSTED", actorType: "SYSTEM", occurredAt: minutesAgo(2695, now) });
  }

  // -------------------------------------------------------------------------
  // 9) STALE — cadence fully exhausted, needs human review
  // -------------------------------------------------------------------------
  {
    const lead = seedLead({
      firstName: "Robert",
      lastName: "Nguyen",
      phone: "+14045550155",
      email: "robert.nguyen@example.com",
      stateCode: "GA",
      city: "Marietta",
      intent: "HOME_EQUITY",
      goal: "CASH_OUT",
      timeline: "EXPLORING",
      creditRange: "FAIR_620_679",
      occupancy: "PRIMARY",
      state: "STALE",
      createdMinutesAgo: 14400,
    });
    addAttempt(lead, "VOICE", "NO_ANSWER", 1, 14300);
    addAttempt(lead, "VOICE", "NO_ANSWER", 2, 10000);
    addAttempt(lead, "VOICE", "NO_ANSWER", 3, 5760);
    addAttempt(lead, "EMAIL", "DELIVERED", 1, 2880);
    pushEvent(lead.id, { type: "CADENCE_EXHAUSTED", actorType: "SYSTEM", occurredAt: minutesAgo(2870, now) });
    const t: Task = {
      id: id("task"),
      leadId: lead.id,
      type: "REVIEW_MISSING_FIELDS",
      dueAt: minutesAgo(-60, now),
      status: "OPEN",
      title: "Cadence exhausted — human review needed",
    };
    db.tasks.set(t.id, t);
  }

  // -------------------------------------------------------------------------
  // 10) SUPPRESSED — opted out mid-cadence via STOP
  // -------------------------------------------------------------------------
  {
    const lead = seedLead({
      firstName: "Karen",
      lastName: "Whitmore",
      phone: "+19715550190",
      email: "karen.w@example.com",
      stateCode: "OR",
      city: "Salem",
      intent: "REFINANCE",
      goal: "LOWER_PAYMENT",
      timeline: "1_3_MONTHS",
      creditRange: "GOOD_680_739",
      occupancy: "PRIMARY",
      state: "SUPPRESSED",
      createdMinutesAgo: 1500,
    });
    addAttempt(lead, "VOICE", "NO_ANSWER", 1, 1450);
    addAttempt(lead, "SMS", "DELIVERED", 1, 1400);
    pushEvent(lead.id, {
      type: "OPT_OUT_RECEIVED",
      actorType: "BORROWER",
      channel: "SMS",
      occurredAt: minutesAgo(1350, now),
      payload: { rawMessage: "STOP" },
    });
    const supp: Suppression = {
      id: id("supp"),
      phoneE164: "+19715550190",
      reason: "OPT_OUT_STOP",
      scope: "GLOBAL",
      createdAt: minutesAgo(1350, now),
      expiresAt: null,
      evidenceEventId: db.events[db.events.length - 1].id,
    };
    db.suppressions.set(supp.phoneE164, supp);
  }

  // -------------------------------------------------------------------------
  // 11) CLOSED_WON
  // -------------------------------------------------------------------------
  {
    const lead = seedLead({
      firstName: "Elena",
      lastName: "Vasquez",
      phone: "+14075550172",
      email: "elena.vasquez@example.com",
      stateCode: "FL",
      city: "Orlando",
      intent: "REFINANCE",
      goal: "LOWER_PAYMENT",
      timeline: "ASAP",
      creditRange: "EXCELLENT_740_PLUS",
      occupancy: "PRIMARY",
      estimatedValue: 445000,
      currentBalance: 250000,
      state: "CLOSED_WON",
      createdMinutesAgo: 20000,
      assignedOfficerId: "off_3",
    });
    addAttempt(lead, "VOICE", "ANSWERED", 1, 19900);
    pushEvent(lead.id, { type: "CONTACT_ANSWERED", actorType: "BORROWER", channel: "VOICE", occurredAt: minutesAgo(19900, now) });
    pushEvent(lead.id, { type: "CONVERSATION_COMPLETED", actorType: "SYSTEM", occurredAt: minutesAgo(19800, now) });
    pushEvent(lead.id, { type: "PACKAGE_READY", actorType: "SYSTEM", occurredAt: minutesAgo(19700, now) });
    pushEvent(lead.id, { type: "OFFICER_ASSIGNED", actorType: "SYSTEM", occurredAt: minutesAgo(19600, now), payload: { officerId: "off_3" } });
    pushEvent(lead.id, { type: "OFFICER_ACKNOWLEDGED", actorType: "OFFICER", actorId: "off_3", actorName: "Dave Kowalski", occurredAt: minutesAgo(19500, now) });
    pushEvent(lead.id, { type: "MARKED_WON", actorType: "OFFICER", actorId: "off_3", actorName: "Dave Kowalski", occurredAt: minutesAgo(5000, now) });
    computeAndSetCompleteness(lead);
    lead.completenessScore = 100;
  }

  // -------------------------------------------------------------------------
  // 12) CLOSED_LOST
  // -------------------------------------------------------------------------
  {
    const lead = seedLead({
      firstName: "Brian",
      lastName: "Foster",
      phone: "+12155550143",
      email: "brian.foster@example.com",
      stateCode: "PA",
      city: "Philadelphia",
      intent: "CASH_OUT",
      goal: "OTHER",
      timeline: "3_6_MONTHS",
      creditRange: "BELOW_620",
      occupancy: "PRIMARY",
      state: "CLOSED_LOST",
      createdMinutesAgo: 25000,
      assignedOfficerId: "off_3",
    });
    addAttempt(lead, "VOICE", "ANSWERED", 1, 24900);
    pushEvent(lead.id, { type: "OFFICER_ASSIGNED", actorType: "SYSTEM", occurredAt: minutesAgo(24000, now), payload: { officerId: "off_3" } });
    pushEvent(lead.id, { type: "OFFICER_ACKNOWLEDGED", actorType: "OFFICER", actorId: "off_3", actorName: "Dave Kowalski", occurredAt: minutesAgo(23900, now) });
    pushEvent(lead.id, { type: "MARKED_LOST", actorType: "OFFICER", actorId: "off_3", actorName: "Dave Kowalski", occurredAt: minutesAgo(10000, now), payload: { reason: "Credit did not meet minimum program requirements" } });
  }

  // -------------------------------------------------------------------------
  // 13) Another NEW + ATTEMPTING_CONTACT for list volume/variety
  // -------------------------------------------------------------------------
  seedLead({
    firstName: "Natalie",
    lastName: "Cho",
    phone: "+14255550188",
    email: "natalie.cho@example.com",
    stateCode: "WA",
    city: "Bellevue",
    intent: "HOME_EQUITY",
    goal: "CASH_OUT",
    timeline: "1_3_MONTHS",
    creditRange: "GOOD_680_739",
    occupancy: "PRIMARY",
    state: "NEW",
    createdMinutesAgo: 1,
  });

  {
    const lead = seedLead({
      firstName: "Carlos",
      lastName: "Mendez",
      phone: "+16025550166",
      email: "carlos.mendez@example.com",
      stateCode: "AZ",
      city: "Mesa",
      intent: "REFINANCE",
      goal: "LOWER_PAYMENT",
      timeline: "ASAP",
      creditRange: "GOOD_680_739",
      occupancy: "PRIMARY",
      state: "ATTEMPTING_CONTACT",
      createdMinutesAgo: 20,
    });
    addAttempt(lead, "VOICE", "BLOCKED", 1, 15, "QUIET_HOURS_LOCAL");
  }

  // -------------------------------------------------------------------------
  // Audit log seed entries
  // -------------------------------------------------------------------------
  db.auditLogs.push(
    {
      id: id("audit"),
      actorId: "user_officer_1",
      actorName: "Marcus Chen",
      action: "VIEW_LEAD",
      resourceType: "Lead",
      resourceId: "lead_sarah",
      ipAddress: "198.51.100.12",
      result: "ALLOW",
      at: minutesAgo(30, now),
    },
    {
      id: id("audit"),
      actorId: "user_compliance",
      actorName: "Dana Whitfield",
      action: "VIEW_SUPPRESSION_LIST",
      resourceType: "Suppression",
      resourceId: "*",
      ipAddress: "198.51.100.4",
      result: "ALLOW",
      at: hoursAgo(3, now),
    }
  );
}
