import Link from "next/link";
import { ShieldX, Users, UserPlus, GitBranch, FileText, ShieldOff, Power, ScrollText, Plug, SlidersHorizontal, HeartHandshake, ShieldQuestion, FileClock, Rocket } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/empty-state";
import { OfficersPanel } from "@/components/admin/officers-panel";
import { UsersPanel } from "@/components/admin/users-panel";
import { SettingsPanel } from "@/components/admin/settings-panel";
import { CadencePanel } from "@/components/admin/cadence-panel";
import { DisclosuresPanel } from "@/components/admin/disclosures-panel";
import { SuppressionPanel } from "@/components/admin/suppression-panel";
import { KillSwitchPanel } from "@/components/admin/kill-switch-panel";
import { AuditLogPanel } from "@/components/admin/audit-log-panel";
import { IntegrationsPanel } from "@/components/admin/integrations-panel";
import { GoLivePanel } from "@/components/admin/go-live-panel";
import { getIntegrationStatusesAction } from "@/domain/integrationActions";
import { ReferralPartnersPanel } from "@/components/admin/referral-partners-panel";
import { IntakeDraftsPanel } from "@/components/admin/intake-drafts-panel";
import { can } from "@/core/rbac";
import {
  getGoLiveReadiness,
  getKillSwitch,
  getSystemConfig,
  listAuditLogs,
  listCadencePlans,
  DRAFT_RETENTION_DAYS,
  listDisclosures,
  listIntakeDrafts,
  listOfficers,
  listReferralPartners,
  listRecentFailedAttempts,
  listRecentKillSwitchBlocks,
  listSuppressions,
  listUsers,
} from "@/domain/queries";
import { getCurrentUser } from "@/domain/session";

export default async function AdminPage() {
  const user = await getCurrentUser();
  const subject = { role: user.role, officerId: user.officerId };

  if (!can(subject, "MANAGE_SUPPRESSION") && !can(subject, "VIEW_AUDIT_LOG")) {
    return (
      <div className="animate-fade-in">
        <PageHeader title="Admin" />
        <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)]">
          <EmptyState icon={ShieldX} title="Restricted" description="Admin and Compliance roles only. Switch roles from the top-right menu to preview this area." />
        </div>
      </div>
    );
  }

  const [officers, users, config, cadencePlans, disclosures, suppressions, killSwitch, auditLogs, referralPartners, killSwitchBlocks, recentFailures, intakeDrafts] = await Promise.all([
    listOfficers(),
    listUsers(),
    getSystemConfig(),
    listCadencePlans(),
    listDisclosures(),
    listSuppressions(),
    getKillSwitch(),
    listAuditLogs(),
    listReferralPartners(),
    listRecentKillSwitchBlocks(),
    listRecentFailedAttempts(),
    listIntakeDrafts(),
  ]);

  // Admin-only; the tab itself is gated below.
  const integrationData = user.role === "ADMIN" ? await getIntegrationStatusesAction() : null;
  const goLive = user.role === "ADMIN" ? await getGoLiveReadiness() : null;

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Admin"
        description="Users, officers, cadence, disclosures, suppression, settings, and the global kill switch."
        actions={
          <Link
            href="/workspace/tasks?type=COMPLAINT&scope=all"
            className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-[13px] font-medium text-[var(--foreground)] shadow-[var(--shadow-xs)] transition-colors hover:bg-[var(--background)]"
          >
            <ShieldQuestion className="h-3.5 w-3.5" /> Compliance review queue
          </Link>
        }
      />

      <Tabs defaultValue="users">
        <TabsList>
          <TabsTrigger value="users">
            <span className="flex items-center gap-1.5">
              <UserPlus className="h-3.5 w-3.5" /> Users
            </span>
          </TabsTrigger>
          <TabsTrigger value="officers">
            <span className="flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5" /> Officers
            </span>
          </TabsTrigger>
          <TabsTrigger value="suppression">
            <span className="flex items-center gap-1.5">
              <ShieldOff className="h-3.5 w-3.5" /> Suppression
            </span>
          </TabsTrigger>
          <TabsTrigger value="settings">
            <span className="flex items-center gap-1.5">
              <SlidersHorizontal className="h-3.5 w-3.5" /> Settings
            </span>
          </TabsTrigger>
          <TabsTrigger value="killswitch">
            <span className="flex items-center gap-1.5">
              <Power className="h-3.5 w-3.5" /> Kill switch
            </span>
          </TabsTrigger>
          <TabsTrigger value="cadence">
            <span className="flex items-center gap-1.5">
              <GitBranch className="h-3.5 w-3.5" /> Cadence
            </span>
          </TabsTrigger>
          <TabsTrigger value="referrals">
            <span className="flex items-center gap-1.5">
              <HeartHandshake className="h-3.5 w-3.5" /> Referral partners
            </span>
          </TabsTrigger>
          <TabsTrigger value="disclosures">
            <span className="flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5" /> Disclosures
            </span>
          </TabsTrigger>
          <TabsTrigger value="integrations">
            <span className="flex items-center gap-1.5">
              <Plug className="h-3.5 w-3.5" /> Integrations
            </span>
          </TabsTrigger>
          <TabsTrigger value="golive">
            <span className="flex items-center gap-1.5">
              <Rocket className="h-3.5 w-3.5" /> Go live
            </span>
          </TabsTrigger>
          <TabsTrigger value="audit">
            <span className="flex items-center gap-1.5">
              <ScrollText className="h-3.5 w-3.5" /> Audit log
            </span>
          </TabsTrigger>
          <TabsTrigger value="drafts">
            <span className="flex items-center gap-1.5">
              <FileClock className="h-3.5 w-3.5" /> Incomplete leads
              {intakeDrafts.length > 0 && (
                <span className="rounded-full bg-[var(--background)] px-1.5 text-[10px] text-[var(--muted-foreground)]">{intakeDrafts.length}</span>
              )}
            </span>
          </TabsTrigger>
        </TabsList>

        <div className="pt-5">
          <TabsContent value="users">
            <UsersPanel users={users} currentUserId={user.id} />
          </TabsContent>
          <TabsContent value="officers">
            <OfficersPanel officers={officers} canEdit={user.role === "ADMIN"} />
          </TabsContent>
          <TabsContent value="suppression">
            <SuppressionPanel suppressions={suppressions} canManage={can(subject, "MANAGE_SUPPRESSION")} isAdmin={user.role === "ADMIN"} />
          </TabsContent>
          <TabsContent value="settings">
            <SettingsPanel config={config} canEdit={user.role === "ADMIN"} />
          </TabsContent>
          <TabsContent value="killswitch">
            <KillSwitchPanel state={killSwitch} canToggle={can(subject, "TOGGLE_KILL_SWITCH")} blockedItems={killSwitchBlocks} />
          </TabsContent>
          <TabsContent value="cadence">
            <CadencePanel plans={cadencePlans} />
          </TabsContent>
          <TabsContent value="referrals">
            <ReferralPartnersPanel partners={referralPartners} />
          </TabsContent>
          <TabsContent value="disclosures">
            <DisclosuresPanel
              disclosures={disclosures}
              canEdit={can(subject, "EDIT_CADENCE_PROMPTS_DISCLOSURES")}
              canApprove={can(subject, "APPROVE_CADENCE_PROMPTS_DISCLOSURES")}
            />
          </TabsContent>
          <TabsContent value="integrations">
            {integrationData ? (
              <IntegrationsPanel
                statuses={integrationData.integrations}
                storageEnabled={integrationData.storageEnabled}
                canEdit={user.role === "ADMIN"}
                recentFailures={recentFailures}
              />
            ) : (
              <EmptyState icon={ShieldX} title="Admin only" description="Provider API keys can only be viewed and changed by an Admin." />
            )}
          </TabsContent>
          <TabsContent value="golive">
            {goLive ? (
              <GoLivePanel items={goLive.items} verdict={goLive.verdict} />
            ) : (
              <EmptyState icon={ShieldX} title="Admin only" description="Go-live readiness can only be viewed by an Admin." />
            )}
          </TabsContent>
          <TabsContent value="audit">
            <AuditLogPanel logs={auditLogs} />
          </TabsContent>
          <TabsContent value="drafts">
            <IntakeDraftsPanel drafts={intakeDrafts} canManage={user.role === "ADMIN"} retentionDays={DRAFT_RETENTION_DAYS} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
