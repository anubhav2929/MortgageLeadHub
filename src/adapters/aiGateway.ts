import { getConfigValue } from "@/lib/runtimeConfig";
import { resolveAiRouteOrder, type AiProvider } from "@/core/aiRouting";

type LiveProvider = Exclude<AiProvider, "NONE">;

export interface AiUsageSample {
  provider: LiveProvider;
  model: string;
  operation: string;
  durationMs: number;
  ok: boolean;
  error?: string;
  at: string;
}

const recentUsage: AiUsageSample[] = [];
const MAX_USAGE_SAMPLES = 250;

export function getRecentAiUsage(): AiUsageSample[] {
  return [...recentUsage];
}

function record(sample: AiUsageSample) {
  recentUsage.push(sample);
  if (recentUsage.length > MAX_USAGE_SAMPLES) recentUsage.splice(0, recentUsage.length - MAX_USAGE_SAMPLES);
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

class ProviderError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
  }
}

async function configuredRoutes(): Promise<LiveProvider[]> {
  const [openai, anthropic, nvidia, priority] = await Promise.all([
    getConfigValue("OPENAI_API_KEY"),
    getConfigValue("ANTHROPIC_API_KEY"),
    getConfigValue("NVIDIA_API_KEY"),
    getConfigValue("AI_PROVIDER_PRIORITY"),
  ]);
  return resolveAiRouteOrder({
    priority,
    availability: { OPENAI: Boolean(openai), ANTHROPIC: Boolean(anthropic), NVIDIA: Boolean(nvidia) },
  });
}

function extractOpenAiText(data: unknown): string {
  const response = data as { output_text?: string; output?: { content?: { type?: string; text?: string }[] }[] };
  if (response.output_text) return response.output_text;
  for (const item of response.output ?? []) {
    for (const content of item.content ?? []) if (content.type === "output_text" && content.text) return content.text;
  }
  throw new ProviderError("OpenAI returned no output text", false);
}

async function callOpenAi(system: string, user: string, maxOutputTokens: number): Promise<{ text: string; model: string }> {
  const key = await getConfigValue("OPENAI_API_KEY");
  const model = (await getConfigValue("OPENAI_MODEL")) || "gpt-4o-mini";
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, instructions: system, input: user, max_output_tokens: maxOutputTokens, store: false }),
  });
  if (!response.ok) throw new ProviderError(`OpenAI request failed (${response.status})`, retryableStatus(response.status));
  return { text: extractOpenAiText(await response.json()), model };
}

async function callAnthropic(system: string, user: string, maxOutputTokens: number): Promise<{ text: string; model: string }> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const model = (await getConfigValue("ANTHROPIC_MODEL")) || "claude-sonnet-5";
  const client = new Anthropic({ apiKey: await getConfigValue("ANTHROPIC_API_KEY") });
  try {
    const message = await client.messages.create({ model, system, max_tokens: maxOutputTokens, messages: [{ role: "user", content: user }] });
    const text = message.content.find((block) => block.type === "text");
    if (!text || text.type !== "text") throw new ProviderError("Anthropic returned no text", false);
    return { text: text.text, model };
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    const status = typeof error === "object" && error && "status" in error ? Number(error.status) : 0;
    throw new ProviderError(error instanceof Error ? error.message : "Anthropic request failed", retryableStatus(status));
  }
}

async function callNvidia(system: string, user: string, maxOutputTokens: number): Promise<{ text: string; model: string }> {
  const key = await getConfigValue("NVIDIA_API_KEY");
  const model = (await getConfigValue("NVIDIA_MODEL")) || "meta/llama-3.1-8b-instruct";
  const response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "system", content: system }, { role: "user", content: user }], max_tokens: maxOutputTokens, temperature: 0.2 }),
  });
  if (!response.ok) throw new ProviderError(`NVIDIA request failed (${response.status})`, retryableStatus(response.status));
  const data = await response.json() as { choices?: { message?: { content?: string } }[] };
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new ProviderError("NVIDIA returned no text", false);
  return { text, model };
}

export async function runAiText(input: {
  operation: string;
  system: string;
  user: string;
  maxOutputTokens?: number;
}): Promise<{ ok: true; text: string; provider: LiveProvider; model: string } | { ok: false; error: string }> {
  const routes = await configuredRoutes();
  if (routes.length === 0) return { ok: false, error: "No AI provider is configured" };

  let lastError = "AI request failed";
  for (const provider of routes) {
    const started = Date.now();
    try {
      const output = provider === "OPENAI"
        ? await callOpenAi(input.system, input.user, input.maxOutputTokens ?? 700)
        : provider === "ANTHROPIC"
          ? await callAnthropic(input.system, input.user, input.maxOutputTokens ?? 700)
          : await callNvidia(input.system, input.user, input.maxOutputTokens ?? 700);
      record({ provider, model: output.model, operation: input.operation, durationMs: Date.now() - started, ok: true, at: new Date().toISOString() });
      return { ok: true, text: output.text, provider, model: output.model };
    } catch (error) {
      const providerError = error instanceof ProviderError ? error : new ProviderError(error instanceof Error ? error.message : "AI request failed", false);
      lastError = providerError.message;
      record({ provider, model: "unknown", operation: input.operation, durationMs: Date.now() - started, ok: false, error: lastError, at: new Date().toISOString() });
      if (!providerError.retryable) break;
    }
  }
  return { ok: false, error: lastError };
}

export async function runAiJson<T>(input: {
  operation: string;
  system: string;
  user: string;
  maxOutputTokens?: number;
  validate: (value: unknown) => T;
}): Promise<{ ok: true; value: T; provider: LiveProvider; model: string } | { ok: false; error: string }> {
  const result = await runAiText({ ...input, system: `${input.system}\nReturn only one valid JSON object without markdown.` });
  if (!result.ok) return result;
  try {
    const raw = result.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    return { ok: true, value: input.validate(JSON.parse(raw)), provider: result.provider, model: result.model };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? `Invalid structured AI output: ${error.message}` : "Invalid structured AI output" };
  }
}
