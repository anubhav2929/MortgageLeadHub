import { validateRequest } from "twilio";

export function formParams(rawBody: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(rawBody).entries());
}

export function verifyTwilioWebhook(input: {
  authToken: string;
  signature: string | null;
  publicUrl: string;
  rawBody: string;
}): boolean {
  if (!input.authToken || !input.signature || !input.publicUrl.startsWith("https://")) return false;
  try {
    return validateRequest(input.authToken, input.signature, input.publicUrl, formParams(input.rawBody));
  } catch {
    return false;
  }
}
