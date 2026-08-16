import { AlertTriangle, ShieldX } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { MessageCentre } from "@/components/workspace/message-centre";
import { can } from "@/core/rbac";
import { listMessageThreads } from "@/domain/queries";
import { getCurrentUser } from "@/domain/session";
import { getCapabilities } from "@/lib/runtimeConfig";

export default async function MessageCentrePage() {
  const user = await getCurrentUser();
  const subject = { role: user.role, officerId: user.officerId };

  if (!can(subject, "VIEW_LEAD_PII")) {
    return (
      <div className="animate-fade-in">
        <PageHeader title="Message centre" />
        <Card>
          <EmptyState icon={ShieldX} title="Restricted" description="You do not have access to borrower messages." />
        </Card>
      </div>
    );
  }

  const [threads, caps] = await Promise.all([listMessageThreads(), getCapabilities()]);

  const awaitingUs = threads.filter((t) => t.awaitingUs).length;
  const failing = threads.filter((t) => t.lastFailure).length;
  const optedOut = threads.filter((t) => t.suppressed).length;

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Message centre"
        description="Automated text follow-ups and borrower replies across every lead — with a way to step in."
      />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Badge tone={caps.hasSms ? "success" : "neutral"}>
          {caps.hasSms ? `Live — ${caps.hasTelnyx ? "Telnyx" : "Twilio"}` : "Simulated — no carrier connected"}
        </Badge>
        {awaitingUs > 0 && <Badge tone="primary">{awaitingUs} awaiting a reply from us</Badge>}
        {failing > 0 && <Badge tone="danger">{failing} with a delivery failure</Badge>}
        {optedOut > 0 && <Badge tone="neutral">{optedOut} opted out</Badge>}
      </div>

      {/* Delivery receipts are what turn "we sent it" into "it arrived".
          Without them every text looks successful, including the ones a
          carrier silently dropped. */}
      {caps.hasSms && !caps.hasInboundEmail && threads.length > 0 && (
        <Card className="mb-5 border-[var(--warning)] bg-[var(--warning-tint)]">
          <CardContent className="flex items-start gap-2.5 p-4">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--warning)]" />
            <p className="text-[13px] text-[var(--foreground)]">
              Replies and delivery receipts need <code className="text-xs">DELIVERY_WEBHOOK_SECRET</code> and the
              carrier webhook pointed at this app. Until then, texts send but nothing comes back — including STOP.
            </p>
          </CardContent>
        </Card>
      )}

      <MessageCentre threads={threads} />
    </div>
  );
}
