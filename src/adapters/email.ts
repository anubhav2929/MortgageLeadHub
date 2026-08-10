// Thin Resend wrapper. Credentials resolve per call via lib/runtimeConfig,
// so a key saved in Admin → Integrations works on the next send with no
// redeploy.

import { getConfigValue } from "@/lib/runtimeConfig";
import { classifyFailure } from "@/core/deliveryStatus";
import { resolveSenderAddress, senderConfigWarning } from "@/core/senderIdentity";
import { adapterFailure, adapterSuccess, type AdapterResult } from "./result";

export interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
  idempotencyKey: string;
  from?: string;
}

export async function sendEmail(input: SendEmailInput): Promise<AdapterResult> {
  const apiKey = await getConfigValue("RESEND_API_KEY");
  if (!apiKey) {
    console.log(`[SIMULATED EMAIL] from=${input.from ?? "n/a"} to=${input.to} subject="${input.subject}"`);
    return adapterSuccess(`sim_email_${input.idempotencyKey}`, true);
  }

  try {
    const fromEmail = await getConfigValue("RESEND_FROM_EMAIL");
    // The configured, verified address wins over whatever the caller passed —
    // see core/senderIdentity.ts. Previously the caller always won, which made
    // RESEND_FROM_EMAIL dead config and sent everything from a fake domain.
    const from = resolveSenderAddress(input.from, fromEmail);
    const warning = senderConfigWarning(from);
    if (warning) console.warn(`[Resend] ${warning}`);

    const { Resend } = await import("resend");
    const resend = new Resend(apiKey);
    const { data, error } = await resend.emails.send({
      from,
      to: input.to,
      subject: input.subject,
      text: input.text,
    });
    if (error) throw new Error(error.message);
    return adapterSuccess(data?.id ?? `email_${input.idempotencyKey}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown Resend error";
    console.error("[Resend] send failed:", message);
    return adapterFailure(classifyFailure("resend", undefined, message));
  }
}
