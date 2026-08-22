// Which AI provider serves a request, decided in one place.
//
// Provider selection used to be inlined in every function that needed a model
// — eight of them, and they did not agree. Most preferred Anthropic and fell
// back to NVIDIA; signal assessment did the reverse; transcript extraction
// supported Anthropic only and silently dropped to a keyword scan on an
// NVIDIA-only deployment while the admin panel reported the LLM as live.
//
// That inconsistency is invisible from the outside: every path still returns
// a plausible answer, so the only symptom is quality varying by feature for
// reasons nobody can explain.
//
// Pure and I/O-free so the routing table is testable without credentials.

export type AiProvider = "ANTHROPIC" | "NVIDIA" | "NONE";

/** Operator preference. AUTO is the default and means "use whatever is
 *  configured", which is the right answer for almost everyone. */
export type AiProviderPreference = "AUTO" | "ANTHROPIC" | "NVIDIA";

export interface AiRoutingInput {
  hasAnthropic: boolean;
  hasNvidia: boolean;
  preference?: AiProviderPreference;
  /**
   * Tasks that need reliable structured output. Anthropic's tool-calling
   * constrains the model to a schema; NVIDIA NIM returns free text we have to
   * parse and validate. Both work, but when a task's output feeds the record
   * rather than a human's eyes, the schema guarantee is worth preferring.
   */
  needsStructuredOutput?: boolean;
}

/**
 * An explicit preference is honoured **only if that provider is configured**.
 *
 * Falling back rather than failing is deliberate: an operator who selects
 * NVIDIA and then removes the key should get degraded-but-working AI, not a
 * silently dead feature across seven surfaces. The admin panel surfaces the
 * mismatch; the runtime keeps working.
 */
export function resolveAiProvider(input: AiRoutingInput): AiProvider {
  const { hasAnthropic, hasNvidia, preference = "AUTO", needsStructuredOutput = false } = input;

  if (preference === "ANTHROPIC" && hasAnthropic) return "ANTHROPIC";
  if (preference === "NVIDIA" && hasNvidia) return "NVIDIA";

  // AUTO, or a preference whose provider is not configured.
  if (needsStructuredOutput) {
    if (hasAnthropic) return "ANTHROPIC";
    if (hasNvidia) return "NVIDIA";
    return "NONE";
  }

  // For everything else prefer the free tier when it is available. High-volume
  // work — outreach copy, discovery assessment — is exactly what a free quota
  // is for, and spending metered credit on it by default is a cost surprise
  // the operator never asked for.
  if (hasNvidia) return "NVIDIA";
  if (hasAnthropic) return "ANTHROPIC";
  return "NONE";
}

/** True when the operator asked for a provider they have not configured. The
 *  panel warns rather than the runtime failing. */
export function preferenceIsUnavailable(input: AiRoutingInput): boolean {
  const { hasAnthropic, hasNvidia, preference = "AUTO" } = input;
  if (preference === "ANTHROPIC") return !hasAnthropic;
  if (preference === "NVIDIA") return !hasNvidia;
  return false;
}
