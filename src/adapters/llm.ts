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
  channel: "VOICE" | "SMS" | "EMAIL";
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
  "end voice scripts with a question inviting the borrower to continue the conversation; end emails with a clear, low-pressure next step. " +
  // SMS is not a short email. A text that opens "Dear Jordan," and closes with
  // a signature block reads as bulk marketing, which is the fastest route to a
  // spam report — and a spam-report rate above roughly 0.1% gets a 10DLC
  // campaign throttled or shut down by the carriers, taking the channel with
  // it. The length limit is also load-bearing: this copy is what the sender
  // truncates if it overruns, and a text cut mid-sentence looks broken.
  "For SMS: write ONE sentence or two at most, under 240 characters total, in the register of a person typing on a phone. " +
  "No greeting line, no sign-off, no subject, no bullet points, no links unless asked for. Identify the business once, naturally.";

/** What we are actually asking the model to produce. Naming the artefact
 *  rather than the channel matters: "follow-up email" and "text message" pull
 *  very different registers out of a model, and asking for an email then
 *  slicing it to SMS length is what produced texts cut off mid-word. */
const CHANNEL_ARTEFACT: Record<OutreachContentInput["channel"], string> = {
  VOICE: "short phone call opening script for the officer to read aloud",
  SMS: "single short text message",
  EMAIL: "follow-up email",
};

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
  const artefact = CHANNEL_ARTEFACT[input.channel];

  const result = await callNvidiaJSON<{ subject?: string; body: string }>(
    OUTREACH_SYSTEM_PROMPT,
    `Write a ${artefact} ` +
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
          `Write a ${CHANNEL_ARTEFACT[input.channel]} ` +
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
  if (input.channel === "SMS") {
    return {
      body:
        `Hi ${input.firstName}, it's ${input.officerFirstName} at Equity Flow Group about your ${intentLabel} inquiry — ` +
        `happy to talk through your options whenever suits. Reply STOP to opt out.`,
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
  // Anthropic first (tool-calling gives a schema guarantee), then NVIDIA NIM,
  // then keyword simulation. The NVIDIA rung used to be missing entirely: a
  // deployment with only NVIDIA_API_KEY set fell straight through to the
  // regex simulator while the admin panel reported the LLM as configured.
  if (!(await anthropicKey())) {
    if (await nvidiaKey()) return classifyIntentWithNvidia(text);
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

// ---------------------------------------------------------------------------
// Signal assessment — the judgement half of lead discovery.
//
// core/discoveryQuery.ts handles what is *measurable*: keywords, recency,
// subreddit, length. It is deterministic and reproducible, and it stays the
// scoring backbone for exactly that reason.
//
// What it cannot do is read a post. Three failure modes survive every keyword
// filter, and all three are expensive because they consume a reviewer's
// attention:
//
//   - Someone *answering* a mortgage question rather than asking one. The
//     vocabulary is identical; the intent is inverted.
//   - Someone describing a mortgage they already closed.
//   - An industry participant phrased carefully enough to miss the
//     promotional-marker list.
//
// A model reading the text catches all three. So the LLM is not used to
// re-derive the score — it is used to answer "is this a borrower who wants
// something we sell, and what is their actual situation".
// ---------------------------------------------------------------------------

export type SignalUrgency = "IMMEDIATE" | "WEEKS" | "RESEARCHING" | "UNKNOWN";

export interface SignalAssessment {
  /** False for industry participants, people answering others, and closed
   *  deals. The single most useful field: it removes work rather than adding
   *  a number to it. */
  isProspect: boolean;
  intent: LoanIntent;
  urgency: SignalUrgency;
  /** One line, in the officer's language, describing the person's actual
   *  circumstance — not a summary of the post. */
  situation: string;
  /** How to open a reply, given what they asked. */
  suggestedAngle: string;
  /** Reasons this may be a poor fit — stated so a reviewer can disagree. */
  concerns: string[];
  /** 0-100 model judgement, blended with the deterministic score by the caller. */
  qualityScore: number;
  simulated: boolean;
}

const URGENCY_VALUES: SignalUrgency[] = ["IMMEDIATE", "WEEKS", "RESEARCHING", "UNKNOWN"];

const ASSESSMENT_SYSTEM =
  "You assess public forum posts for a US mortgage lender's lead-discovery review queue. " +
  "The reader is a licensed loan officer deciding whether to write a helpful public reply. " +
  "Judge the AUTHOR, not the topic. Set isProspect false if the author is a loan officer, realtor, " +
  "broker or other industry participant; if they are answering or advising someone else rather than " +
  "seeking help; if their loan has already closed; or if they are outside the United States. " +
  "Be strict: a false positive wastes an officer's time and risks an unwelcome approach. " +
  "situation must describe the person's circumstance in one plain sentence. " +
  "suggestedAngle must be a concrete opening for a helpful public reply, never a sales pitch. " +
  "concerns lists genuine reasons this may be a poor fit. " +
  'Reply as {"isProspect": bool, "intent": one of ' +
  `${INTENT_VALUES.join("|")}, "urgency": one of ${URGENCY_VALUES.join("|")}, ` +
  '"situation": string, "suggestedAngle": string, "concerns": [string], "qualityScore": 0-100}.';

/**
 * Runs on NVIDIA NIM (free tier) by preference — this is high-volume,
 * low-stakes classification over public text, which is exactly the workload
 * worth spending a free quota on rather than per-token Anthropic credit.
 */
export async function assessSignal(input: {
  title: string;
  body: string;
  subreddit: string;
}): Promise<SignalAssessment> {
  const text = `Subreddit: r/${input.subreddit}\nTitle: ${input.title}\n\nPost:\n${input.body.slice(0, 3000)}`;

  if (await nvidiaKey()) {
    try {
      return normaliseAssessment(await callNvidiaJSON<Record<string, unknown>>(ASSESSMENT_SYSTEM, text, 500));
    } catch (err) {
      console.error("[NVIDIA signal assessment] failed:", err);
    }
  }

  if (await anthropicKey()) {
    try {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const client = new Anthropic({ apiKey: (await anthropicKey())! });
      const message = await client.messages.create({
        model: MODEL,
        max_tokens: 500,
        system: ASSESSMENT_SYSTEM,
        messages: [{ role: "user", content: text }],
      });
      const block = message.content.find((b) => b.type === "text");
      if (block && block.type === "text") {
        const cleaned = block.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
        return normaliseAssessment(JSON.parse(cleaned) as Record<string, unknown>);
      }
    } catch (err) {
      console.error("[Anthropic signal assessment] failed:", err);
    }
  }

  return {
    isProspect: true,
    intent: "UNKNOWN",
    urgency: "UNKNOWN",
    situation: "",
    suggestedAngle: "",
    concerns: [],
    qualityScore: 0,
    simulated: true,
  };
}

/**
 * Validates model output field by field.
 *
 * `isProspect` defaults to TRUE when the model omits it or returns something
 * unparseable. That may look backwards for a filter whose job is exclusion,
 * but the alternative is worse: a malformed response would silently discard a
 * genuine lead, and nobody would ever see the post to notice. A junk response
 * should degrade to "a human decides", which is the pre-AI behaviour.
 */
function normaliseAssessment(raw: Record<string, unknown>): SignalAssessment {
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const score = typeof raw.qualityScore === "number" && Number.isFinite(raw.qualityScore)
    ? Math.max(0, Math.min(100, Math.round(raw.qualityScore)))
    : 0;

  return {
    isProspect: raw.isProspect === false ? false : true,
    intent: INTENT_VALUES.includes(raw.intent as LoanIntent) ? (raw.intent as LoanIntent) : "UNKNOWN",
    urgency: URGENCY_VALUES.includes(raw.urgency as SignalUrgency) ? (raw.urgency as SignalUrgency) : "UNKNOWN",
    situation: str(raw.situation, 300),
    suggestedAngle: str(raw.suggestedAngle, 400),
    concerns: Array.isArray(raw.concerns)
      ? raw.concerns.filter((c): c is string => typeof c === "string").map((c) => c.slice(0, 200)).slice(0, 5)
      : [],
    qualityScore: score,
    simulated: false,
  };
}

async function classifyIntentWithNvidia(text: string): Promise<IntentClassification> {
  try {
    const result = await callNvidiaJSON<{
      intent?: string;
      confidence?: number;
      matchedKeywords?: unknown;
    }>(
      "You classify whether a public forum post expresses genuine intent to refinance a mortgage, do a cash-out " +
        "refinance, or take a home equity loan. Return UNKNOWN if the post is unrelated or too vague. " +
        `Reply as {"intent": one of ${INTENT_VALUES.join("|")}, "confidence": 0-1, "matchedKeywords": [strings]}.`,
      text,
      250
    );

    // NIM has no tool-calling schema guarantee, so validate rather than trust.
    // An out-of-enum intent silently becomes a real LoanIntent otherwise, and
    // a hallucinated "PURCHASE" would propagate into routing.
    const intent = INTENT_VALUES.includes(result.intent as LoanIntent)
      ? (result.intent as LoanIntent)
      : "UNKNOWN";
    const confidence =
      typeof result.confidence === "number" && Number.isFinite(result.confidence)
        ? Math.max(0, Math.min(1, result.confidence))
        : 0;
    const matchedKeywords = Array.isArray(result.matchedKeywords)
      ? result.matchedKeywords.filter((k): k is string => typeof k === "string").slice(0, 12)
      : [];

    return { intent, confidence, matchedKeywords, simulated: false };
  } catch (err) {
    console.error("[NVIDIA intent classification] falling back to simulated classification:", err);
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
