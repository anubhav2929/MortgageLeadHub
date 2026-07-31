import { notFound } from "next/navigation";
import { LayoutGrid, Clock3, FileText, MessageSquare, ShieldCheck, CheckSquare, StickyNote } from "lucide-react";
import { TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LeadDetailTabs } from "@/components/workspace/lead-detail-tabs";
import { LeadDetailHeader } from "@/components/workspace/lead-detail-header";
import { OverviewTab } from "@/components/workspace/tabs/overview-tab";
import { TimelineTab } from "@/components/workspace/tabs/timeline-tab";
import { PackageTab } from "@/components/workspace/tabs/package-tab";
import { ConversationTab } from "@/components/workspace/tabs/conversation-tab";
import { ConsentTab } from "@/components/workspace/tabs/consent-tab";
import { TasksTab } from "@/components/workspace/tabs/tasks-tab";
import { NotesTab } from "@/components/workspace/tabs/notes-tab";
import { can } from "@/core/rbac";
import { computeLeadCompleteness, getLeadByRef, listOfficers, listReferralPartners } from "@/domain/queries";
import { getCurrentUser } from "@/domain/session";

interface PageProps {
  params: Promise<{ publicRef: string }>;
}

export default async function LeadDetailPage({ params }: PageProps) {
  const { publicRef } = await params;
  const detail = await getLeadByRef(publicRef);
  if (!detail) notFound();

  const user = await getCurrentUser();
  const subject = { role: user.role, officerId: user.officerId };
  const canViewPii = can(subject, "VIEW_LEAD_PII", detail.lead);
  const canTakeOver = user.role === "ADMIN" || user.role === "OFFICER";
  const canCallNow = can(subject, "CALL_NOW", detail.lead);
  const canMarkWonLost = can(subject, "MARK_WON_LOST", detail.lead);
  const canAcknowledge = detail.lead.state === "ASSIGNED" && (user.role === "ADMIN" || user.officerId === detail.lead.assignedOfficerId);

  const { score: completenessScore, missing } = await computeLeadCompleteness(detail.lead.id);
  const referralPartners = await listReferralPartners();
  const fullName = detail.person ? `${detail.person.firstName} ${detail.person.lastName}` : "Unknown borrower";
  const canAssignOfficer = user.role === "ADMIN";
  const officers = canAssignOfficer ? (await listOfficers()).filter((o) => o.isActive) : undefined;

  return (
    <div className="animate-fade-in">
      <LeadDetailHeader
        lead={detail.lead}
        fullName={fullName}
        canTakeOver={canTakeOver}
        canCallNow={canCallNow}
        canMarkWonLost={canMarkWonLost}
        canAcknowledge={canAcknowledge}
        assignedOfficerName={detail.officer?.name}
      />

      <LeadDetailTabs>
        <TabsList>
          <TabsTrigger value="overview">
            <span className="flex items-center gap-1.5">
              <LayoutGrid className="h-3.5 w-3.5" /> Overview
            </span>
          </TabsTrigger>
          <TabsTrigger value="timeline">
            <span className="flex items-center gap-1.5">
              <Clock3 className="h-3.5 w-3.5" /> Timeline
              <span className="rounded-full bg-[var(--background)] px-1.5 text-[10px] text-[var(--muted-foreground)]">
                {detail.events.length}
              </span>
            </span>
          </TabsTrigger>
          <TabsTrigger value="package">
            <span className="flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5" /> Package
            </span>
          </TabsTrigger>
          <TabsTrigger value="conversation">
            <span className="flex items-center gap-1.5">
              <MessageSquare className="h-3.5 w-3.5" /> Conversation
            </span>
          </TabsTrigger>
          <TabsTrigger value="consent">
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5" /> Consent
            </span>
          </TabsTrigger>
          <TabsTrigger value="tasks">
            <span className="flex items-center gap-1.5">
              <CheckSquare className="h-3.5 w-3.5" /> Tasks
            </span>
          </TabsTrigger>
          <TabsTrigger value="notes">
            <span className="flex items-center gap-1.5">
              <StickyNote className="h-3.5 w-3.5" /> Notes
            </span>
          </TabsTrigger>
        </TabsList>

        <div className="pt-5">
          <TabsContent value="overview">
            <OverviewTab
              lead={detail.lead}
              person={detail.person}
              officer={detail.officer}
              cadencePlan={detail.cadencePlan}
              canViewPii={canViewPii}
              missing={missing}
              completenessScore={completenessScore}
              referralPartners={referralPartners}
              canRefer={canCallNow}
              qualityScore={detail.qualityScore}
              propertyValuation={detail.propertyValuation}
              attemptsToday={detail.attemptsToday}
              officers={officers}
              canAssignOfficer={canAssignOfficer}
            />
          </TabsContent>
          <TabsContent value="timeline">
            <TimelineTab publicRef={publicRef} events={detail.events} attempts={detail.attempts} />
          </TabsContent>
          <TabsContent value="package">
            <PackageTab publicRef={publicRef} fields={detail.leadFields} />
          </TabsContent>
          <TabsContent value="conversation">
            <ConversationTab publicRef={publicRef} conversations={detail.conversations} candidates={detail.fieldCandidates} />
          </TabsContent>
          <TabsContent value="consent">
            <ConsentTab consents={detail.consents} policyDecisions={detail.policyDecisions} />
          </TabsContent>
          <TabsContent value="tasks">
            <TasksTab publicRef={publicRef} tasks={detail.tasks} />
          </TabsContent>
          <TabsContent value="notes">
            <NotesTab publicRef={publicRef} notes={detail.notes} />
          </TabsContent>
        </div>
      </LeadDetailTabs>
    </div>
  );
}
