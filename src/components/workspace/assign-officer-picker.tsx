"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { assignOfficerAction } from "@/domain/actions";
import type { Officer } from "@/domain/types";

export function AssignOfficerPicker({ publicRef, officers, currentOfficerId }: { publicRef: string; officers: Officer[]; currentOfficerId?: string }) {
  const [selected, setSelected] = useState(currentOfficerId ?? "");
  const [isPending, startTransition] = useTransition();
  const { push } = useToast();
  const router = useRouter();

  function submit() {
    if (!selected || selected === currentOfficerId) return;
    startTransition(async () => {
      const result = await assignOfficerAction(publicRef, selected);
      push({ title: result.message, tone: result.ok ? "success" : "danger" });
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-1.5">
      <Select value={selected} onChange={(e) => setSelected(e.target.value)} className="h-8 w-auto min-w-40 text-[13px]">
        <option value="">Choose an officer…</option>
        {officers.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </Select>
      <Button size="sm" className="h-8" loading={isPending} disabled={!selected || selected === currentOfficerId} onClick={submit}>
        Assign
      </Button>
    </div>
  );
}
