import { describe, expect, it } from "vitest";
import { getExpectedTwilioSignature } from "twilio";
import { formParams, verifyTwilioWebhook } from "@/adapters/twilioWebhookAuth";

describe("Twilio webhook authentication", () => {
  const authToken = "test_auth_token";
  const publicUrl = "https://www.equityflowgroup.com/api/webhooks/inbound/twilio";
  const rawBody = "MessageSid=SM123&From=%2B14155550100&Body=STOP";

  it("accepts the provider signature over the exact public URL and form", () => {
    const signature = getExpectedTwilioSignature(authToken, publicUrl, formParams(rawBody));
    expect(verifyTwilioWebhook({ authToken, signature, publicUrl, rawBody })).toBe(true);
  });

  it("rejects an altered URL or body", () => {
    const signature = getExpectedTwilioSignature(authToken, publicUrl, formParams(rawBody));
    expect(verifyTwilioWebhook({ authToken, signature, publicUrl: `${publicUrl}?secret=legacy`, rawBody })).toBe(false);
    expect(verifyTwilioWebhook({ authToken, signature, publicUrl, rawBody: `${rawBody}+NOW` })).toBe(false);
  });
});
