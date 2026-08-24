"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CalendarClock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { cancelCallbackAppointmentAction, rescheduleCallbackAppointmentAction } from "@/domain/actions";
import type { CallbackAppointmentView } from "@/domain/queries";
import { formatDateTime } from "@/lib/utils";

export function CallbackAppointmentBoard({ appointments }: { appointments: CallbackAppointmentView[] }) {
  const [reschedule, setReschedule] = useState<Record<string, string>>({});
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const { push } = useToast();

  function run(action: () => Promise<{ ok: boolean; message: string }>) {
    startTransition(async () => {
      const result = await action();
      push({ title: result.message, tone: result.ok ? "success" : "danger" });
      if (result.ok) router.refresh();
    });
  }

  return (
    <Card className="mb-5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><CalendarClock className="h-4 w-4" /> Callback appointments</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {appointments.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">No callback appointments are scheduled.</p>
        ) : appointments.map(({ appointment, leadPublicRef, borrowerName, officerName, transferStatus }) => {
          const manageable = appointment.status === "BOOKED" || appointment.status === "CONFIRMED";
          return (
            <div key={appointment.id} className="rounded-[var(--radius-md)] border border-[var(--border)] p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <Link href={`/workspace/leads/${leadPublicRef}`} className="text-sm font-medium text-[var(--primary)] hover:underline">{borrowerName}</Link>
                  <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                    {formatDateTime(appointment.startsAt)} · {appointment.borrowerTimezone} · {officerName ?? "Central queue"}
                  </p>
                </div>
                <div className="flex gap-2"><Badge tone={appointment.status === "CANCELLED" ? "neutral" : "primary"}>{appointment.status}</Badge>{transferStatus && <Badge tone="neutral">Transfer {transferStatus}</Badge>}</div>
              </div>
              {manageable && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Input
                    type="datetime-local"
                    value={reschedule[appointment.id] ?? ""}
                    onChange={(event) => setReschedule((current) => ({ ...current, [appointment.id]: event.target.value }))}
                    className="w-auto"
                    disabled={isPending}
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={isPending || !reschedule[appointment.id]}
                    onClick={() => run(() => rescheduleCallbackAppointmentAction(appointment.id, new Date(reschedule[appointment.id]).toISOString()))}
                  >Reschedule</Button>
                  <Button size="sm" variant="ghost" disabled={isPending} onClick={() => run(() => cancelCallbackAppointmentAction(appointment.id, "Cancelled by operator from the call centre"))}>Cancel</Button>
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
