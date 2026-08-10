// Structured extraction adapter — SPEC.md F-06. Turns a transcript into typed
// field candidates with confidence + provenance. When ANTHROPIC_API_KEY is
// set, this calls the real Claude API with a schema-constrained tool so the
// model can only emit one of the allowed values per field, or UNKNOWN. With
// no key, a deterministic keyword scan produces the same shape of output —
// same downstream promotion pipeline, real (if shallow) evidence — so the
// whole extraction → promotion → package UI loop is demoable without a key.

import { getConfigValue } from "@/lib/runtimeConfig";
import type { ConversationTurn, GoalType, LoanIntent } from "@/domain/types";

// ---------------------------------------------------------------------------
// NVIDIA NIM (build.nvidia.com) — free-tier, OpenAI-compatible chat completion
// endpoint. Used as a no-cost alternative to Anthropic for the "AI messaging"
// functions (outreach drafts, signal replies) when ANTHROPIC_API_KEY isn't
// set but NVIDIA_API_KEY is. Plain fetch, no SDK dependency — the API is a
// single JSON POST.
// ---------------------------------------------------------------------------
const NVIDIA_DEFAULT_MODEL = "meta/llama-3.1-8b-instruct";

// Credentials resolve per call (lib/runtimeConfig) rather than at module
// load, so a key saved in Admin → Integrations takes effect immediately.
async function anthropicKey(): Promise<string | undefined> {
  return getConfigValue("ANTHROPIC_API_KEY");
}
async function nvidiaKey(): Promise<string | undefined> {
  return getConfigValue("NVIDIA_API_KEY");
}

async function callNvidiaJSON<T>(system: string, user: string, maxTokens = 400): Promise<T> {
  const key = await nvidiaKey();
  const model = (await getConfigValue("NVIDIA_MODEL")) || NVIDIA_DEFAULT_MODEL;
  const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: `${system} Respond with ONLY a single valid JSON object — no markdown, no code fences, no commentary.` },
        { role: "user", content: user },
      ],
      temperature: 0.4,
      max_tokens: maxTokens,
    }),
  });
  if (!res.ok) throw new Error(`NVIDIA NIM request failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const raw = data.choices?.[0]?.message?.content;
  if (!raw) throw new Error("NVIDIA NIM returned no content");
  // Models occasionally wrap JSON in a code fence despite instructions — strip it.
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  return JSON.parse(cleaned) as T;
}

export interface ExtractedField {
  fieldPath: string;
  value: string | boolean;
  confidence: number;
  transcriptTurnRefs: number[];
}

export interface ExtractionResult {
  fields: ExtractedField[];
  simulated: boolean;
}

const FIELD_ENUMS: Record<string, string[] | "boolean"> = {
  "contact.reachable": "boolean",
  "property.identified": "boolean",
  "property.occupancy": ["PRIMARY", "SECOND_HOME", "INVESTMENT", "UNKNOWN"],
  "loan.purpose": ["LOWER_PAYMENT", "CASH_OUT", "SHORTEN_TERM", "DEBT_CONSOLIDATION", "OTHER", "UNKNOWN"],
  "borrower.timeline": ["ASAP", "1_3_MONTHS", "3_6_MONTHS", "EXPLORING", "UNKNOWN"],
  "borrower.creditBand": ["EXCELLENT_740_PLUS", "GOOD_680_739", "FAIR_620_679", "BELOW_620", "UNSURE", "UNKNOWN"],
  "borrower.incomeBand": ["W2_STEADY", "SELF_EMPLOYED", "MIXED", "UNKNOWN"],
};

const MODEL = "claude-sonnet-5";

export async function extractFieldsFromTranscript(transcript: ConversationTurn[]): Promise<ExtractionResult> {
  if (!(await anthropicKey())) {
    return { fields: simulateExtraction(transcript), simulated: true };
  }

  try {
    const fields = await extractWithClaude(transcript);
    return { fields, simulated: false };
  } catch (err) {
    console.error("[Anthropic extraction] falling back to simulated extraction:", err);
    return { fields: simulateExtraction(transcript), simulated: true };
  }
}

async function extractWithClaude(transcript: ConversationTurn[]): Promise<ExtractedField[]> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: (await anthropicKey())! });

  const transcriptText = transcript.map((t) => `[turn ${t.turn}] ${t.role}: ${t.text}`).join("\n");

  const properties: Record<string, unknown> = {};
  for (const [path, domain] of Object.entries(FIELD_ENUMS)) {
    properties[path] = {
      type: "object",
      properties: {
        value: domain === "boolean" ? { type: "string", enum: ["true", "false", "UNKNOWN"] } : { type: "string", enum: domain },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        turnRefs: { type: "array", items: { type: "integer" } },
      },
      required: ["value", "confidence", "turnRefs"],
    };
  }

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system:
      "You extract structured facts from a mortgage qualification call transcript. " +
      "If the borrower did not clearly state a field, return UNKNOWN for it with confidence 0 and an empty turnRefs array. " +
      "Never infer, never guess, never quote a rate or approval odds. turnRefs must point at the exact turn numbers where the fact was stated.",
    tools: [
      {
        name: "record_extracted_fields",
        description: "Record one structured value per field, each with a confidence score and the transcript turns it was drawn from.",
        input_schema: {
          type: "object",
          properties,
          required: Object.keys(FIELD_ENUMS),
        },
      },
    ],
    tool_choice: { type: "tool", name: "record_extracted_fields" },
    messages: [{ role: "user", content: `Transcript:\n${transcriptText}` }],
  });

  const toolUse = message.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") throw new Error("Model did not return the expected tool call");

  const input = toolUse.input as Record<string, { value: string; confidence: number; turnRefs: number[] }>;
  const fields: ExtractedField[] = [];
  for (const [fieldPath, result] of Object.entries(input)) {
    const domain = FIELD_ENUMS[fieldPath];
    const value: string | boolean = domain === "boolean" ? result.value === "true" : result.value;
    fields.push({
      fieldPath,
      value,
      confidence: result.value === "UNKNOWN" ? 0 : result.confidence,
      transcriptTurnRefs: result.turnRefs ?? [],
    });
  }
  return fields;
}

function simulateExtraction(transcript: ConversationTurn[]): ExtractedField[] {
  const fields: ExtractedField[] = [];
  const borrowerTurns = transcript.filter((t) => t.role === "BORROWER");

  if (borrowerTurns.length > 0) {
    fields.push({ fieldPath: "contact.reachable", value: true, confidence: 0.95, transcriptTurnRefs: [borrowerTurns[0].turn] });
  }

  const scan = (patterns: [RegExp, string][], fieldPath: string, confidence = 0.8) => {
    for (const turn of borrowerTurns) {
      for (const [re, value] of patterns) {
        if (re.test(turn.text)) {
          fields.push({ fieldPath, value, confidence, transcriptTurnRefs: [turn.turn] });
          return;
        }
      }
    }
  };

  scan(
    [
      [/investment|rental|tenant/i, "INVESTMENT"],
      [/second home|vacation home/i, "SECOND_HOME"],
      [/primary residence|primary home|live (here|there)|my home/i, "PRIMARY"],
    ],
    "property.occupancy"
  );

  scan(
    [
      [/consolidat|credit card|debt/i, "DEBT_CONSOLIDATION"],
      [/cash.?out|cash out|access (some )?cash|equity out/i, "CASH_OUT"],
      [/shorten|pay (it )?off faster|15.?year/i, "SHORTEN_TERM"],
      [/lower (my )?(rate|payment)/i, "LOWER_PAYMENT"],
    ],
    "loan.purpose"
  );

  scan(
    [
      [/as soon as possible|asap|right away|urgent/i, "ASAP"],
      [/exploring|just looking|not sure yet/i, "EXPLORING"],
    ],
    "borrower.timeline",
    0.75
  );

  scan(
    [
      [/excellent|800|750|740/i, "EXCELLENT_740_PLUS"],
      [/good|high 600s|low 700s|68\d|69\d|7[0-3]\d/i, "GOOD_680_739"],
      [/fair|620|630|640|650/i, "FAIR_620_679"],
      [/below 620|poor|bad credit/i, "BELOW_620"],
    ],
    "borrower.creditBand",
    0.7
  );

  scan(
    [
      [/self.?employed|own (my |a )?business|freelance/i, "SELF_EMPLOYED"],
      [/w.?2|steady job|salaried|same (job|employer)/i, "W2_STEADY"],
    ],
    "borrower.incomeBand",
    0.75
  );

  return fields;
}

// ---------------------------------------------------------------------------
// Intake identity validation — SPEC.md task-list "AI Validation" item. Runs
// synchronously on the public, unauthenticated submit path, so it must be
// fast and must never block or reject a submission: it only normalizes
// name casing and flags placeholder-looking data for an officer to verify.
// Same simulate-by-default shape as the rest of this file — a deterministic
// heuristic always runs; a real model call only refines it further.
// ---------------------------------------------------------------------------

export interface IdentityValidationInput {
  firstName: string;
  lastName: string;
  email: string;
}

export interface IdentityValidationResult {
  firstName: string;
  lastName: string;
  flags: string[];
  simulated: boolean;
}

const PLACEHOLDER_NAME_RE = /^(test|asdf|qwerty|xxx+|none|n\/a|na|unknown|foo|bar|abc|sample|example|first ?name|last ?name)$/i;
const DISPOSABLE_EMAIL_DOMAINS = ["mailinator.com", "guerrillamail.com", "10minutemail.com", "tempmail.com", "trashmail.com"];

function toTitleCase(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, " ")
    .split(/(-|'|\s)/)
    .map((part) => (/^[a-z]/i.test(part) ? part.charAt(0).toUpperCase() + part.slice(1).toLowerCase() : part))
    .join("");
}

function heuristicFlags(firstName: string, lastName: string, email: string): string[] {
  const flags: string[] = [];
  for (const [label, value] of [
    ["first name", firstName],
    ["last name", lastName],
  ] as const) {
    const trimmed = value.trim();
    if (PLACEHOLDER_NAME_RE.test(trimmed)) flags.push(`${label} looks like placeholder text`);
    else if (/^(.)\1*$/.test(trimmed)) flags.push(`${label} is a repeated character`);
    else if (/\d/.test(trimmed)) flags.push(`${label} contains digits`);
    else if (trimmed.length < 2) flags.push(`${label} is unusually short`);
  }
  const domain = email.split("@")[1]?.toLowerCase();
  if (domain && DISPOSABLE_EMAIL_DOMAINS.includes(domain)) flags.push("email uses a disposable/temporary domain");
  return flags;
}

export async function validateIntakeIdentity(input: IdentityValidationInput): Promise<IdentityValidationResult> {
  const heuristic: IdentityValidationResult = {
    firstName: toTitleCase(input.firstName),
    lastName: toTitleCase(input.lastName),
    flags: heuristicFlags(input.firstName, input.lastName, input.email),
    simulated: true,
  };

  if (!(await anthropicKey()) && !(await nvidiaKey())) return heuristic;

  const system =
    "You review a mortgage intake form's name fields for data quality. Normalize each name to standard title " +
    "case (preserve legitimate multi-part names, hyphens, and apostrophes). Flag ONLY if a name is clearly " +
    "placeholder/test data, gibberish, or obviously not a real human name — never flag a name just because it's " +
    "unusual or non-English. Keep flags short (a few words each). If nothing is wrong, return an empty flags array.";
  const user = `firstName: "${input.firstName}"\nlastName: "${input.lastName}"`;

  try {
    if (await anthropicKey()) {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const client = new Anthropic({ apiKey: (await anthropicKey())! });
      const message = await client.messages.create({
        model: MODEL,
        max_tokens: 200,
        system,
        tools: [
          {
            name: "record_validation",
            description: "Record the normalized names and any data quality flags.",
            input_schema: {
              type: "object",
              properties: {
                firstName: { type: "string" },
                lastName: { type: "string" },
                flags: { type: "array", items: { type: "string" } },
              },
              required: ["firstName", "lastName", "flags"],
            },
          },
        ],
        tool_choice: { type: "tool", name: "record_validation" },
        messages: [{ role: "user", content: user }],
      });
      const toolUse = message.content.find((b) => b.type === "tool_use");
      if (!toolUse || toolUse.type !== "tool_use") throw new Error("Model did not return the expected tool call");
      const result = toolUse.input as { firstName: string; lastName: string; flags: string[] };
      return { firstName: result.firstName || heuristic.firstName, lastName: result.lastName || heuristic.lastName, flags: result.flags, simulated: false };
    }
    const result = await callNvidiaJSON<{ firstName: string; lastName: string; flags: string[] }>(
      system,
      `${user}\nReply as JSON shaped exactly like {"firstName": "...", "lastName": "...", "flags": ["..."]}.`,
      200
    );
    return { firstName: result.firstName || heuristic.firstName, lastName: result.lastName || heuristic.lastName, flags: result.flags ?? [], simulated: false };
  } catch (err) {
    console.error("[AI identity validation] falling back to heuristic:", err);
    return heuristic;
  }
}

// ---------------------------------------------------------------------------
// AI-generated outreach content — "AI dialer" script + AI email agent.
// Same compliance prohibitions as the conversational agent (SPEC.md F-05):
// never quote a rate/payment/approval odds, never claim approval, never give
// financial/legal/tax advice. The model only ever produces the *content* of
// a message; PolicyGate still decides, separately, whether it's allowed to
// go out at all.
// ---------------------------------------------------------------------------

export interface OutreachContentInput {
  channel: "VOICE" | "EMAIL";
  firstName: string;
  intent: LoanIntent;
  goal: GoalType;
  officerFirstName: string;
  isFirstContact: boolean;
  /** What's already been said to this borrower, across every channel — see
   *  core/conversationThread.ts buildConversationBrief(). Without it the model
   *  re-introduces itself on the fourth touch and contradicts things the
   *  borrower already told us on a different channel. */
  priorContext?: string;
}

export interface OutreachContentResult {
  subject?: string;
  body: string;
  simulated: boolean;
}

const OUTREACH_SYSTEM_PROMPT =
  "You write short, warm, compliant outreach messages for a licensed mortgage lending desk. " +
  "Hard rules, never break these: never quote a rate, payment amount, or approval odds; " +
  'never say "you qualify", "you\'re approved", or "you\'ll likely get"; never claim to be a human if the format implies one (for voice scripts, the officer reading it IS human, so this doesn\'t apply); ' +
  "never give legal, tax, or financial advice; never ask for SSN, date of birth, or account numbers; keep it under 60 words; " +
  "end voice scripts with a question inviting the borrower to continue the conversation; end emails with a clear, low-pressure next step.";

export async function generateOutreachContent(input: OutreachContentInput): Promise<OutreachContentResult> {
  if (await anthropicKey()) {
    try {
      return await generateWithClaude(input);
    } catch (err) {
      console.error("[Anthropic outreach content] falling back:", err);
    }
  }
  if (await nvidiaKey()) {
    try {
      return await generateWithNvidia(input);
    } catch (err) {
      console.error("[NVIDIA NIM outreach content] falling back to simulated content:", err);
    }
  }
  return simulateOutreachContent(input);
}

async function generateWithNvidia(input: OutreachContentInput): Promise<OutreachContentResult> {
  const intentLabel = input.intent.replace("_", " ").toLowerCase();
  const goalLabel = input.goal.replace("_", " ").toLowerCase();
  const shape = input.channel === "EMAIL" ? `{"subject": "...", "body": "..."}` : `{"body": "..."}`;

  const result = await callNvidiaJSON<{ subject?: string; body: string }>(
    OUTREACH_SYSTEM_PROMPT,
    `Write a ${input.channel === "VOICE" ? "short phone call opening script for the officer to read aloud" : "follow-up email"} ` +
      `from loan officer ${input.officerFirstName} to a borrower named ${input.firstName} who submitted a ${intentLabel} inquiry ` +
      `with the goal of "${goalLabel}". This is their ${input.isFirstContact ? "first" : "a follow-up"} contact attempt. ` +
      (input.priorContext
        ? `\n\nWhat has already been said to this borrower, across every channel — do not repeat it, do not re-introduce yourself, and do not contradict it:\n${input.priorContext}\n\n`
        : "") +
      `Reply as JSON shaped exactly like ${shape}.`
  );
  return { subject: result.subject, body: result.body, simulated: false };
}

async function generateWithClaude(input: OutreachContentInput): Promise<OutreachContentResult> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: (await anthropicKey())! });

  const intentLabel = input.intent.replace("_", " ").toLowerCase();
  const goalLabel = input.goal.replace("_", " ").toLowerCase();

  const properties =
    input.channel === "EMAIL"
      ? { subject: { type: "string" }, body: { type: "string" } }
      : { body: { type: "string" } };

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 400,
    system: OUTREACH_SYSTEM_PROMPT,
    tools: [
      {
        name: "write_message",
        description: "Write the outreach message.",
        input_schema: { type: "object", properties, required: Object.keys(properties) },
      },
    ],
    tool_choice: { type: "tool", name: "write_message" },
    messages: [
      {
        role: "user",
        content:
          `Write a ${input.channel === "VOICE" ? "short phone call opening script for the officer to read aloud" : "follow-up email"} ` +
          `from loan officer ${input.officerFirstName} to a borrower named ${input.firstName} who submitted a ${intentLabel} inquiry ` +
          `with the goal of "${goalLabel}". This is their ${input.isFirstContact ? "first" : "a follow-up"} contact attempt.` +
          (input.priorContext
            ? `\n\nWhat has already been said to this borrower, across every channel — do not repeat it, do not re-introduce yourself, and do not contradict it:\n${input.priorContext}`
            : ""),
      },
    ],
  });

  const toolUse = message.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") throw new Error("Model did not return the expected tool call");
  const result = toolUse.input as { subject?: string; body: string };
  return { subject: result.subject, body: result.body, simulated: false };
}

function simulateOutreachContent(input: OutreachContentInput): OutreachContentResult {
  const intentLabel = input.intent.replace("_", " ").toLowerCase();
  if (input.channel === "EMAIL") {
    return {
      subject: `Following up on your ${intentLabel} inquiry`,
      body:
        `Hi ${input.firstName},\n\nThanks for reaching out about your ${intentLabel} inquiry. I'd love to walk you through ` +
        `your options whenever works for you — no pressure, just a conversation.\n\nReply here or call me back at your convenience.\n\n${input.officerFirstName}`,
      simulated: true,
    };
  }
  return {
    body:
      `Hi, this is ${input.officerFirstName} from Equity Flow Group following up on your ${intentLabel} inquiry. ` +
      `Do you have a couple of minutes to talk through your options?`,
    simulated: true,
  };
}

// ---------------------------------------------------------------------------
// Reply drafts for discovered signals — "reply directly to this inquiry"
// from the call. Always a draft for a human to review and post themselves;
// this adapter has no posting capability and never touches the Reddit API
// beyond the read-only search in leadDiscovery.ts.
// ---------------------------------------------------------------------------

export interface SignalReplyInput {
  title: string;
  snippet: string;
  subreddit: string;
}

const SIGNAL_REPLY_SYSTEM_PROMPT =
  "You write short, genuinely helpful Reddit replies from a licensed mortgage lending company's official account, responding to a stranger's post about refinancing or home equity. " +
  "Hard rules, never break these: never quote a rate, payment amount, or approval odds; never say \"you qualify\" or \"you're approved\"; " +
  "sound like a knowledgeable person adding value to the thread, not an ad; one soft, low-pressure mention that the company can help them compare options if they want, with no link or contact info (that goes in a profile, not the reply body); keep it under 80 words.";

export async function generateSignalReply(input: SignalReplyInput): Promise<{ body: string; simulated: boolean }> {
  if (await anthropicKey()) {
    try {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const client = new Anthropic({ apiKey: (await anthropicKey())! });
      const message = await client.messages.create({
        model: MODEL,
        max_tokens: 250,
        system: SIGNAL_REPLY_SYSTEM_PROMPT,
        tools: [
          {
            name: "write_reply",
            description: "Write the Reddit reply.",
            input_schema: { type: "object", properties: { body: { type: "string" } }, required: ["body"] },
          },
        ],
        tool_choice: { type: "tool", name: "write_reply" },
        messages: [
          {
            role: "user",
            content: `Post in r/${input.subreddit} titled "${input.title}":\n\n${input.snippet}\n\nDraft a reply.`,
          },
        ],
      });
      const toolUse = message.content.find((b) => b.type === "tool_use");
      if (!toolUse || toolUse.type !== "tool_use") throw new Error("Model did not return the expected tool call");
      return { body: (toolUse.input as { body: string }).body, simulated: false };
    } catch (err) {
      console.error("[Anthropic signal reply] falling back:", err);
    }
  }
  if (await nvidiaKey()) {
    try {
      const result = await callNvidiaJSON<{ body: string }>(
        SIGNAL_REPLY_SYSTEM_PROMPT,
        `Post in r/${input.subreddit} titled "${input.title}":\n\n${input.snippet}\n\nDraft a reply. Reply as JSON shaped exactly like {"body": "..."}.`,
        250
      );
      return { body: result.body, simulated: false };
    } catch (err) {
      console.error("[NVIDIA NIM signal reply] falling back to simulated content:", err);
    }
  }
  return simulateSignalReply(input);
}

function simulateSignalReply(input: SignalReplyInput): { body: string; simulated: boolean } {
  return {
    body:
      `Re: "${input.title}" — happy to share a general perspective here. The right call really depends on your rate, timeline, and how long you plan to stay in the home. ` +
      `If it'd help to run your specific numbers, feel free to reach out through our team — no pressure either way, just want to make sure you're comparing apples to apples before deciding.`,
    simulated: true,
  };
}

// ---------------------------------------------------------------------------
// Intent classification for the lead discovery engine (public forum posts).
// This only ever labels text that a human will review — see
// adapters/leadDiscovery.ts for why nothing here auto-contacts anyone.
// ---------------------------------------------------------------------------

export interface IntentClassification {
  intent: LoanIntent;
  confidence: number;
  matchedKeywords: string[];
  simulated: boolean;
}

const INTENT_VALUES: LoanIntent[] = ["REFINANCE", "HOME_EQUITY", "CASH_OUT", "UNKNOWN"];

export async function classifySignalIntent(text: string): Promise<IntentClassification> {
  if (!(await anthropicKey())) {
    return simulateIntentClassification(text);
  }
  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: (await anthropicKey())! });
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 200,
      system:
        "You classify whether a public forum post expresses genuine intent to refinance a mortgage, do a cash-out refinance, " +
        "or take a home equity loan. Return UNKNOWN if the post is unrelated or too vague. List the specific words/phrases that drove your decision.",
      tools: [
        {
          name: "classify",
          description: "Classify the post's refinance/equity intent.",
          input_schema: {
            type: "object",
            properties: {
              intent: { type: "string", enum: INTENT_VALUES },
              confidence: { type: "number", minimum: 0, maximum: 1 },
              matchedKeywords: { type: "array", items: { type: "string" } },
            },
            required: ["intent", "confidence", "matchedKeywords"],
          },
        },
      ],
      tool_choice: { type: "tool", name: "classify" },
      messages: [{ role: "user", content: text }],
    });
    const toolUse = message.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") throw new Error("Model did not return the expected tool call");
    const result = toolUse.input as { intent: LoanIntent; confidence: number; matchedKeywords: string[] };
    return { ...result, simulated: false };
  } catch (err) {
    console.error("[Anthropic intent classification] falling back to simulated classification:", err);
    return simulateIntentClassification(text);
  }
}

function simulateIntentClassification(text: string): IntentClassification {
  const patterns: [RegExp, LoanIntent][] = [
    [/cash.?out refi|cash out my equity|pull (out |some )?equity/i, "CASH_OUT"],
    [/home equity loan|heloc|borrow against (my|our) home/i, "HOME_EQUITY"],
    [/refinanc|lower (my|our) rate|refi (my|our) mortgage/i, "REFINANCE"],
  ];
  for (const [re, intent] of patterns) {
    const match = text.match(re);
    if (match) {
      return { intent, confidence: 0.72, matchedKeywords: [match[0]], simulated: true };
    }
  }
  return { intent: "UNKNOWN", confidence: 0, matchedKeywords: [], simulated: true };
}

// ---------------------------------------------------------------------------
// Borrower-facing chat answers (post-submit status page).
//
// This is the single highest-risk AI surface in the product: it talks
// directly to a consumer about a mortgage, unsupervised, in real time. The
// guardrails are therefore hard rules in the system prompt AND a structural
// escape hatch — the model must set `needsHuman` for anything it shouldn't
// answer, and the caller always files an officer task regardless of what
// comes back. The AI shortens the wait; it never replaces the officer.
// ---------------------------------------------------------------------------

export interface BorrowerAnswerInput {
  question: string;
  firstName: string;
  intent: LoanIntent;
  goal: GoalType;
  stateCode: string;
  officerFirstName?: string;
  /** Prior conversation across every channel — core/conversationThread.ts. */
  priorContext?: string;
}

export interface BorrowerAnswerResult {
  reply: string;
  needsHuman: boolean;
  simulated: boolean;
}

const BORROWER_CHAT_SYSTEM_PROMPT =
  "You answer questions from a borrower who just submitted a mortgage refinance or home-equity inquiry. " +
  "You work for Equity Flow Group. Be warm, brief (under 70 words), and plain-spoken. " +
  "HARD RULES, never break these: never quote a rate, payment amount, APR, fee, or approval odds; " +
  'never say "you qualify", "you\'re approved", "you\'ll likely get", or anything predicting an outcome; ' +
  "never give legal, tax, or financial advice; never ask for an SSN, date of birth, bank or card number; " +
  "never claim to be a human — if asked, say you're an assistant and a licensed officer will follow up. " +
  "Set needsHuman=true whenever the question asks about rates, pricing, eligibility, approval, timelines you " +
  "cannot know, anything requiring their file, or if they sound upset or ask for a person. " +
  "When needsHuman is true, still write a brief, kind holding reply that tells them a licensed loan officer " +
  "will follow up — never attempt the substantive answer anyway.";

export async function answerBorrowerQuestion(input: BorrowerAnswerInput): Promise<BorrowerAnswerResult> {
  const officer = input.officerFirstName ?? "a licensed loan officer";
  const userPrompt =
    `Borrower: ${input.firstName} (${input.intent.replace("_", " ").toLowerCase()}, goal: ${input.goal
      .replace("_", " ")
      .toLowerCase()}, property in ${input.stateCode}). Assigned officer: ${officer}.` +
    (input.priorContext ? `\n\nWhat's already been said across channels:\n${input.priorContext}` : "") +
    `\n\nTheir question: "${input.question}"`;

  if (await anthropicKey()) {
    try {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const client = new Anthropic({ apiKey: (await anthropicKey())! });
      const message = await client.messages.create({
        model: MODEL,
        max_tokens: 300,
        system: BORROWER_CHAT_SYSTEM_PROMPT,
        tools: [
          {
            name: "answer_borrower",
            description: "Reply to the borrower and flag whether a human must take over.",
            input_schema: {
              type: "object",
              properties: {
                reply: { type: "string" },
                needsHuman: { type: "boolean" },
              },
              required: ["reply", "needsHuman"],
            },
          },
        ],
        tool_choice: { type: "tool", name: "answer_borrower" },
        messages: [{ role: "user", content: userPrompt }],
      });
      const toolUse = message.content.find((b) => b.type === "tool_use");
      if (!toolUse || toolUse.type !== "tool_use") throw new Error("Model did not return the expected tool call");
      const result = toolUse.input as { reply: string; needsHuman: boolean };
      return { reply: result.reply, needsHuman: result.needsHuman, simulated: false };
    } catch (err) {
      console.error("[Anthropic borrower chat] falling back:", err);
    }
  }

  if (await nvidiaKey()) {
    try {
      const result = await callNvidiaJSON<{ reply: string; needsHuman: boolean }>(
        BORROWER_CHAT_SYSTEM_PROMPT,
        `${userPrompt}\n\nReply as JSON shaped exactly like {"reply": "...", "needsHuman": true|false}.`,
        300
      );
      return { reply: result.reply, needsHuman: Boolean(result.needsHuman), simulated: false };
    } catch (err) {
      console.error("[NVIDIA borrower chat] falling back:", err);
    }
  }

  // No LLM configured: the honest answer is that a human will handle it,
  // which is exactly what happens. Never fake an AI answer.
  return {
    reply: `Thanks ${input.firstName} — I've passed this straight to ${officer}, who'll follow up shortly.`,
    needsHuman: true,
    simulated: true,
  };
}
