// Thin Resend wrapper.

import { capabilities, env } from "@/lib/env";

export interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
  idempotencyKey: string;
  from?: string;
}

export interface AdapterSendResult {
  providerMessageId: string;
  simulated: boolean;
  error?: string;
}

export async function sendEmail(input: SendEmailInput): Promise<AdapterSendResult> {
  if (!capabilities.hasResend) {
    console.log(`[SIMULATED EMAIL] from=${input.from ?? "n/a"} to=${input.to} subject="${input.subject}"`);
    return { providerMessageId: `sim_email_${input.idempotencyKey}`, simulated: true };
  }

  try {
    const { Resend } = await import("resend");
    const resend = new Resend(env.RESEND_API_KEY!);
    const { data, error } = await resend.emails.send({
      from: input.from || env.RESEND_FROM_EMAIL || "leads@mortgageleadhub.demo",
      to: input.to,
      subject: input.subject,
      text: input.text,
    });
    if (error) throw new Error(error.message);
    return { providerMessageId: data?.id ?? `email_${input.idempotencyKey}`, simulated: false };
  } catch (err) {
    const error = err instanceof Error ? err.message : "Unknown Resend error";
    console.error("[Resend] send failed:", error);
    return { providerMessageId: `failed_${input.idempotencyKey}`, simulated: false, error };
  }
}
