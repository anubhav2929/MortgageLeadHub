import { CheckSquare } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { TaskQueueList } from "@/components/workspace/task-queue-list";
import { TaskQueueFilters } from "@/components/workspace/task-queue-filters";
import { listAllTasks } from "@/domain/queries";
import { getCurrentUser } from "@/domain/session";

interface PageProps {
  searchParams: Promise<{ status?: string; scope?: string; type?: string }>;
}

export default async function TasksPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const [allTasks, user] = await Promise.all([listAllTasks(), getCurrentUser()]);

  const isOfficer = user.role === "OFFICER";
  const scope = isOfficer ? "mine" : "all";
  const status = params.status === "all" ? "all" : params.status === "completed" ? "completed" : "open";
  const type = params.type ?? "";

  let tasks = allTasks;
  if (scope === "mine") tasks = tasks.filter((t) => t.leadAssignedOfficerId === user.officerId);
  if (status === "open") tasks = tasks.filter((t) => t.status === "OPEN");
  else if (status === "completed") tasks = tasks.filter((t) => t.status === "COMPLETED");
  if (type) tasks = tasks.filter((t) => t.type === type);

  const isComplianceQueue = type === "COMPLAINT";

  return (
    <div className="animate-fade-in">
      <PageHeader
        title={isComplianceQueue ? "Compliance review queue" : "Tasks"}
        description={`${tasks.length} task${tasks.length === 1 ? "" : "s"}${isComplianceQueue ? " flagged for compliance review, across every lead" : " across your leads"}`}
      />

      <TaskQueueFilters isOfficer={isOfficer} status={status} type={type} />

      {tasks.length === 0 ? (
        <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)]">
          <EmptyState icon={CheckSquare} title="No tasks match these filters" description="Nothing needs your attention right now." />
        </div>
      ) : (
        <TaskQueueList tasks={tasks} />
      )}
    </div>
  );
}
