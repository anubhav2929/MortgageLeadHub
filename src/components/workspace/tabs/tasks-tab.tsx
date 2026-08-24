"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CheckSquare, Square, Plus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Input, Label, Select } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { SnoozeSelect } from "@/components/workspace/snooze-select";
import { completeTaskAction, createTaskAction } from "@/domain/actions";
import { formatDateTime, titleCase } from "@/lib/utils";
import type { Task, TaskType } from "@/domain/types";

const STATUS_TONE: Record<Task["status"], "neutral" | "success" | "warning"> = {
  OPEN: "warning",
  COMPLETED: "success",
  CANCELLED: "neutral",
};

const TASK_TYPES: TaskType[] = ["FOLLOW_UP", "REVIEW_MISSING_FIELDS", "ACKNOWLEDGE_HANDOFF", "COMPLAINT"];

export function TasksTab({ publicRef, tasks, canManage }: { publicRef: string; tasks: Task[]; canManage: boolean }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [type, setType] = useState<TaskType>("FOLLOW_UP");
  const [dueInHours, setDueInHours] = useState(24);
  const [isPending, startTransition] = useTransition();
  const { push } = useToast();
  const router = useRouter();

  function submit() {
    startTransition(async () => {
      const result = await createTaskAction(publicRef, type, title, dueInHours);
      push({ title: result.message, tone: result.ok ? "success" : "danger" });
      if (result.ok) {
        setOpen(false);
        setTitle("");
      }
      router.refresh();
    });
  }

  function complete(taskId: string) {
    startTransition(async () => {
      const result = await completeTaskAction(publicRef, taskId);
      push({ title: result.message, tone: result.ok ? "success" : "danger" });
      router.refresh();
    });
  }

  return (
    <div>
      {canManage && (
        <div className="mb-4 flex justify-end">
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> Add task
          </Button>
        </div>
      )}

      {tasks.length === 0 ? (
        <Card>
          <EmptyState icon={CheckSquare} title="No tasks" description="Tasks are created automatically at key workflow moments, or add one yourself." />
        </Card>
      ) : (
        <Card>
          <CardContent className="divide-y divide-[var(--border)] p-0">
            {tasks.map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-3 px-5 py-3.5">
                <button
                  className="flex items-center gap-2.5 text-left disabled:cursor-default"
                  disabled={!canManage || t.status !== "OPEN" || isPending}
                  onClick={() => complete(t.id)}
                >
                  {t.status === "COMPLETED" ? (
                    <CheckSquare className="h-4 w-4 shrink-0 text-[var(--success)]" />
                  ) : (
                    <Square className="h-4 w-4 shrink-0 text-[var(--muted-foreground)] hover:text-[var(--primary)]" />
                  )}
                  <div>
                    <p className="text-[13px] font-medium text-[var(--foreground)]">{t.title}</p>
                    <p className="text-xs text-[var(--muted-foreground)]">
                      {titleCase(t.type)} · due {formatDateTime(t.dueAt)}
                    </p>
                  </div>
                </button>
                <div className="flex shrink-0 items-center gap-2">
                  {canManage && t.status === "OPEN" && <SnoozeSelect publicRef={publicRef} taskId={t.id} onDone={() => router.refresh()} />}
                  <Badge tone={STATUS_TONE[t.status]}>{t.status}</Badge>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add task"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" loading={isPending} disabled={!title.trim()} onClick={submit}>
              Create task
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Follow up about credit band" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Type</Label>
              <Select value={type} onChange={(e) => setType(e.target.value as TaskType)}>
                {TASK_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {titleCase(t)}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Due in (hours)</Label>
              <Input type="number" min={1} value={dueInHours} onChange={(e) => setDueInHours(Number(e.target.value))} />
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
