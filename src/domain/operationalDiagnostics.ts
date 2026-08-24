import { getRecentAiUsage, type AiUsageSample } from "@/adapters/aiGateway";
import { getDb } from "@/domain/store";
import { ensureOperationalSchema, hasSqlDatabase, sqlQuery } from "@/domain/sql";
import { getAppUrl, getCapabilities, getConfigValue } from "@/lib/runtimeConfig";
import type { InboundCallTriage } from "@/domain/types";

export interface OperationalDiagnostics {
  webhookCounts: Record<string, number>;
  queueAvailable: boolean;
  inboundCallTriage: InboundCallTriage[];
  aiUsage: AiUsageSample[];
  adminTimezone: string;
  timezoneConfirmed: boolean;
  telnyxPrimaryUrl: string;
  telnyxFailoverUrl: string;
  telnyxSignedWebhooksReady: boolean;
  vapiCredentialReady: boolean;
  capabilities: Awaited<ReturnType<typeof getCapabilities>>;
}

export async function getOperationalDiagnostics(): Promise<OperationalDiagnostics> {
  const [db, appUrl, capabilities, telnyxPublicKey, vapiCredential] = await Promise.all([
    getDb(), getAppUrl(), getCapabilities(), getConfigValue("TELNYX_PUBLIC_KEY"), getConfigValue("VAPI_WEBHOOK_CREDENTIAL_ID"),
  ]);
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
    telnyxPrimaryUrl: `${appUrl}/api/webhooks/telnyx`,
    telnyxFailoverUrl: `${appUrl}/api/webhooks/telnyx/failover`,
    telnyxSignedWebhooksReady: Boolean(telnyxPublicKey),
    vapiCredentialReady: Boolean(vapiCredential),
    capabilities,
  };
}
