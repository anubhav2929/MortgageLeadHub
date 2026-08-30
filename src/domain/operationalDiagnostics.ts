import { getRecentAiUsage, type AiUsageSample } from "@/adapters/aiGateway";
import { getDb } from "@/domain/store";
import { ensureOperationalSchema, hasSqlDatabase, sqlQuery } from "@/domain/sql";
import { getCapabilities, getConfigValue, getPublicUrlResolution } from "@/lib/runtimeConfig";
import type { InboundCallTriage } from "@/domain/types";

export interface OperationalDiagnostics {
  webhookCounts: Record<string, number>;
  queueAvailable: boolean;
  inboundCallTriage: InboundCallTriage[];
  aiUsage: AiUsageSample[];
  adminTimezone: string;
  timezoneConfirmed: boolean;
  publicAppUrl: string;
  publicUrlSource: string;
  publicUrlWarning?: string;
  telnyxPrimaryUrl: string;
  telnyxFailoverUrl: string;
  vapiWebhookUrl: string;
  resendDeliveryUrl: string;
  resendInboundUrl: string;
  telnyxSignedWebhooksReady: boolean;
  capabilities: Awaited<ReturnType<typeof getCapabilities>>;
}

export async function getOperationalDiagnostics(): Promise<OperationalDiagnostics> {
  const [db, publicUrl, capabilities, telnyxPublicKey] = await Promise.all([
    getDb(), getPublicUrlResolution(), getCapabilities(), getConfigValue("TELNYX_PUBLIC_KEY"),
  ]);
  const appUrl = publicUrl.url;
  let queueAvailable = false;
  const webhookCounts: Record<string, number> = {};
  if (hasSqlDatabase()) {
    try {
      await ensureOperationalSchema();
      const rows = await sqlQuery<{ status: string; count: string }>("SELECT status, count(*)::text AS count FROM webhook_inbox GROUP BY status");
      for (const row of rows) webhookCounts[row.status] = Number(row.count);
      queueAvailable = true;
    } catch {
      queueAvailable = false;
    }
  }
  return {
    webhookCounts,
    queueAvailable,
    inboundCallTriage: db.inboundCallTriage.filter((item) => item.status === "OPEN"),
    aiUsage: getRecentAiUsage().slice(-30).reverse(),
    adminTimezone: db.config.adminTimezone ?? "UTC",
    timezoneConfirmed: Boolean(db.config.timezoneConfirmed),
    publicAppUrl: appUrl,
    publicUrlSource: publicUrl.source,
    publicUrlWarning: publicUrl.configuredInvalid
      ? `The saved APP_URL is invalid (${publicUrl.configuredError ?? "invalid value"}); provider URLs are using the Vercel fallback.`
      : undefined,
    telnyxPrimaryUrl: `${appUrl}/api/webhooks/telnyx`,
    telnyxFailoverUrl: `${appUrl}/api/webhooks/telnyx/failover`,
    vapiWebhookUrl: `${appUrl}/api/webhooks/vapi`,
    resendDeliveryUrl: `${appUrl}/api/webhooks/delivery/resend`,
    resendInboundUrl: `${appUrl}/api/webhooks/resend-inbound`,
    telnyxSignedWebhooksReady: Boolean(telnyxPublicKey),
    capabilities,
  };
}
