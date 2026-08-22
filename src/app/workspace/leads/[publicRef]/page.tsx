import { notFound } from "next/navigation";
import { LayoutGrid, Clock3, FileText, MessageSquare, ShieldCheck, CheckSquare, StickyNote, PhoneCall } from "lucide-react";
import { TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LeadDetailTabs } from "@/components/workspace/lead-detail-tabs";
import { LeadDetailHeader } from "@/components/workspace/lead-detail-header";
import { OverviewTab } from "@/components/workspace/tabs/overview-tab";
import { CallInsightsCard } from "@/components/workspace/call-insights-card";
import { TimelineTab } from "@/components/workspace/tabs/timeline-tab";
import { PackageTab } from "@/components/workspace/tabs/package-tab";
import { ConversationTab } from "@/components/workspace/tabs/conversation-tab";
import { ConsentTab } from "@/components/workspace/tabs/consent-tab";
import { TasksTab } from "@/components/workspace/tabs/tasks-tab";
import { NotesTab } from "@/components/workspace/tabs/notes-tab";
import { CallsTab } from "@/components/workspace/tabs/calls-tab";
import { can } from "@/core/rbac";
import { buildLeadThread } from "@/core/conversationThread";
import { deriveCallInsights } from "@/core/callInsights";
import { computeLeadCompleteness, getLeadByRef, listLeadDocuments, listOfficers, listReferralPartners } from "@/domain/queries";
import { getCurrentUser } from "@/domain/session";
import { currentVoiceStrategy } from "@/domain/voiceOrchestrator";
import { getConfigValue } from "@/lib/runtimeConfig";

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
  // One thread across every channel, derived from the records that already
  // exist rather than a parallel store that could drift.
  const thread = buildLeadThread({
    attempts: detail.attempts,
    conversations: detail.conversations,
    notes: detail.notes,
    // Opens the thread with what the borrower told the intake form, so the
    // Conversation tab reads as one continuous exchange from first contact.
    intake: {
      submittedAt: detail.lead.createdAt,
      intent: detail.lead.intent,
      goal: detail.lead.goal,
      timeline: detail.lead.timeline,
      stateCode: detail.lead.stateCode,
      occupancy: detail.lead.occupancy,
      estimatedValue: detail.lead.estimatedValue,
      currentBalance: detail.lead.currentBalance,
      missedPayments: detail.lead.missedPayments,
    },
  });
  // Voice readiness is resolved per request, so entering a Vapi key in the
  // admin panel flips this card from "Configuring" to "Ready" on the next
  // page load — no redeploy, no restart.
  // Extraction writes to db.leadFields; the Lead record is only written by a
  // manual edit. This is the difference between the two.
  const callInsights = deriveCallInsights(detail.lead, detail.leadFields, detail.fieldCandidates);
  const voiceStrategy = await currentVoiceStrategy();
  const inboundNumber = (await getConfigValue("INBOUND_PHONE_NUMBER")) ?? null;
  const documents = await listLeadDocuments(detail.lead.id);
  // Whether the officer can actually route a disclosure for signature, rather
  // than only store it. Resolved per request like every other credential.
  const eSignConfigured = Boolean(await getConfigValue("DOCUSIGN_ACCOUNT_ID"));
  const calls = detail.attempts
    .filter((a) => a.channel === "VOICE")
    .sort((a, b) => new Date(b.startedAt ?? b.scheduledFor).getTime() - new Date(a.startedAt ?? a.scheduledFor).getTime());

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
        canEdit={can(subject, "EDIT_FIELDS", detail.lead)}
        canDelete={user.role === "ADMIN"}
        editable={{
          firstName: detail.person?.firstName ?? "",
          lastName: detail.person?.lastName ?? "",
          phoneE164: detail.person?.phoneE164 ?? "",
          email: detail.person?.email ?? "",
          city: detail.lead.city ?? "",
          stateCode: detail.lead.stateCode,
          addressLine1: detail.lead.addressLine1,
          intent: detail.lead.intent,
          goal: detail.lead.goal,
          timeline: detail.lead.timeline,
          creditRange: detail.lead.creditRange,
          occupancy: detail.lead.occupancy,
          estimatedValue: detail.lead.estimatedValue,
          currentBalance: detail.lead.currentBalance,
          preferredContactWindow: detail.person?.preferredContactWindow ?? "ANY",
        }}
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
          <TabsTrigger value="calls">
            <PhoneCall className="mr-1.5 h-3.5 w-3.5" /> Calls
            {calls.length > 0 && <span className="ml-1.5 text-[var(--muted-foreground)]">{calls.length}</span>}
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
            {/* What the call told us that the header does not yet say. Sits
                above the profile because the officer reads the header before
                dialling, and a stale goal there is acted on. */}
            <CallInsightsCard publicRef={publicRef} insights={callInsights} />
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
              creditPull={detail.creditPull}
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
          <TabsContent value="calls">
            <CallsTab
              publicRef={detail.lead.publicRef}
              borrowerName={fullName}
              borrowerPhone={detail.person?.phoneE164 ?? ""}
              inboundNumber={inboundNumber}
              outboundReady={voiceStrategy.mechanism === "VAPI_AGENT"}
              outboundNote={`${voiceStrategy.reason}${voiceStrategy.remedy ? ` ${voiceStrategy.remedy}` : ""}`}
              calls={calls}
            />
          </TabsContent>
          <TabsContent value="conversation">
            <ConversationTab publicRef={publicRef} conversations={detail.conversations} candidates={detail.fieldCandidates} thread={thread} />
          </TabsContent>
          <TabsContent value="consent">
            <ConsentTab consents={detail.consents} policyDecisions={detail.policyDecisions} />
          </TabsContent>
          <TabsContent value="tasks">
            <TasksTab publicRef={publicRef} tasks={detail.tasks} />
          </TabsContent>
          <TabsContent value="notes">
            <NotesTab
              publicRef={publicRef}
              notes={detail.notes}
              documents={documents}
              canEdit={can(subject, "EDIT_FIELDS")}
              eSignConfigured={eSignConfigured}
            />
          </TabsContent>
        </div>
      </LeadDetailTabs>
    </div>
  );
}
