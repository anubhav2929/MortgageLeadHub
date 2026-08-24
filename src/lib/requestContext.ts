import { createHash, randomUUID } from "node:crypto";
import { headers } from "next/headers";

export interface RequestContext {
  ipAddress: string;
  correlationId: string;
  userAgent: string;
}

export async function getRequestContext(): Promise<RequestContext> {
  try {
    const values = await headers();
    const forwarded = values.get("x-forwarded-for")?.split(",")[0]?.trim();
    return {
      ipAddress: forwarded || values.get("x-real-ip") || "unknown",
      correlationId: values.get("x-request-id") || values.get("x-vercel-id") || randomUUID(),
      userAgent: values.get("user-agent") || "unknown",
    };
  } catch {
    return { ipAddress: "unknown", correlationId: randomUUID(), userAgent: "unknown" };
  }
}

export function privacyHash(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}
