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
  // Explicit and always-respected, not a side effect that silently drops the
  // moment any other filter is touched — an officer filtering by SLA breach
  // still expects that to mean "my breached leads," not "everyone's."
  const mine = isOfficer && params.mine !== "false";

  let leads = searchedLeads;

  if (mine) {
    leads = leads.filter((l) => l.assignedOfficerId === user.officerId || !l.assignedOfficerId);
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

  const stateCodes = Array.from(new Set(allLeads.map((l) => l.stateCode))).sort();
  const officerNames = officers.map((o) => o.name);

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Leads"
        description={`${leads.length} of ${allLeads.length} leads${mine ? " · showing your queue (assigned to you + unassigned)" : ""}`}
      />

      <LeadFilters stateCodes={stateCodes} officerNames={officerNames} isOfficer={isOfficer} mine={mine} />

      {leads.length === 0 ? (
        <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)]">
          <EmptyState icon={Users} title="No leads match these filters" description="Try clearing a filter or broadening your search." />
        </div>
      ) : (
        <LeadTable leads={leads} isAdmin={user.role === "ADMIN"} officers={officers.filter((o) => o.isActive)} />
      )}
    </div>
  );
}
