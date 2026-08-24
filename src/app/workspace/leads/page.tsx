import { Users } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { LeadFilters } from "@/components/workspace/lead-filters";
import { LeadTable } from "@/components/workspace/lead-table";
import { EmptyState } from "@/components/ui/empty-state";
import { listLeads, listOfficers } from "@/domain/queries";
import { getCurrentUser } from "@/domain/session";

interface PageProps {
  searchParams: Promise<{ [key: string]: string | undefined }>;
}

export default async function LeadsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  // listLeads() (no query) gives the true total + the full set of state
  // codes for the filter dropdown; listLeads(params.q) does the actual name/
  // phone/email search server-side, against the raw person record, so the
  // filtered-out leads' contact info never has to be shipped to the client
  // just to power a text search.
  const [allLeads, searchedLeads, officers, user] = await Promise.all([
    listLeads(),
    listLeads(params.q),
    listOfficers(),
    getCurrentUser(),
  ]);

  const isOfficer = user.role === "OFFICER";
  const officer = isOfficer ? officers.find((item) => item.id === user.officerId) : undefined;
  const canOfficerAccess = (lead: (typeof searchedLeads)[number]) =>
    lead.assignedOfficerId === user.officerId || (!lead.assignedOfficerId && Boolean(officer?.licensedStates.includes(lead.stateCode)));
  const scopedAllLeads = isOfficer ? allLeads.filter(canOfficerAccess) : allLeads;

  let leads = isOfficer ? searchedLeads.filter(canOfficerAccess) : searchedLeads;

  if (user.role === "READ_ONLY") {
    leads = leads.map((lead) => ({
      ...lead,
      fullName: "Restricted borrower",
      addressLine1: undefined,
      city: undefined,
      postalCode: undefined,
      estimatedValue: undefined,
      currentBalance: undefined,
      propertyValuation: undefined,
    }));
  }

  if (params.state) leads = leads.filter((l) => l.state === params.state);
  if (params.intent) leads = leads.filter((l) => l.intent === params.intent);
  if (params.officer === "unassigned") leads = leads.filter((l) => !l.assignedOfficerId);
  else if (params.officer) leads = leads.filter((l) => l.officerName === params.officer);
  if (params.stateCode) leads = leads.filter((l) => l.stateCode === params.stateCode);
  if (params.sla === "breached") leads = leads.filter((l) => l.slaBreached);

  const sortKey = params.sort;
  const sortDir = params.dir === "asc" ? 1 : -1;
  if (sortKey === "name") leads = [...leads].sort((a, b) => sortDir * a.fullName.localeCompare(b.fullName));
  else if (sortKey === "sla") leads = [...leads].sort((a, b) => sortDir * (a.minutesToSla - b.minutesToSla));
  else if (sortKey === "completeness") leads = [...leads].sort((a, b) => sortDir * (a.completenessScore - b.completenessScore));
  else if (sortKey === "created") leads = [...leads].sort((a, b) => sortDir * (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()));

  const stateCodes = Array.from(new Set(scopedAllLeads.map((l) => l.stateCode))).sort();
  const officerNames = isOfficer ? [] : officers.map((o) => o.name);

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Leads"
        description={`${leads.length} of ${scopedAllLeads.length} leads${isOfficer ? " · assigned to you plus unassigned leads in your licensed states" : ""}`}
      />

      <LeadFilters stateCodes={stateCodes} officerNames={officerNames} isOfficer={isOfficer} mine={isOfficer} />

      {leads.length === 0 ? (
        <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)]">
          <EmptyState icon={Users} title="No leads match these filters" description="Try clearing a filter or broadening your search." />
        </div>
      ) : (
        <LeadTable leads={leads} isAdmin={user.role === "ADMIN"} canCall={user.role === "ADMIN" || user.role === "OFFICER"} officers={officers.filter((o) => o.isActive)} />
      )}
    </div>
  );
}
