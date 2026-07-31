"use client";

import { useTransition } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useRouter } from "next/navigation";
import { confirmFieldAction } from "@/domain/actions";

export function FieldConflict({
  publicRef,
  fieldPath,
  formValue,
  conversationValue,
}: {
  publicRef: string;
  fieldPath: string;
  formValue: string;
  conversationValue: string;
}) {
  const [isPending, startTransition] = useTransition();
  const { push } = useToast();
  const router = useRouter();

  function resolve(value: string) {
    startTransition(async () => {
      const result = await confirmFieldAction(publicRef, fieldPath, value);
      push({ title: result.message, tone: result.ok ? "success" : "danger" });
      router.refresh();
    });
  }

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--warning-border)] bg-[var(--warning-tint)] p-3">
      <p className="mb-2 flex items-center gap-1.5 text-[13px] font-medium text-[var(--warning)]">
        <AlertTriangle className="h-3.5 w-3.5" /> Conflicting values — pick which one is correct
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" loading={isPending} onClick={() => resolve(formValue)}>
          Form said: {formValue}
        </Button>
        <Button size="sm" variant="secondary" loading={isPending} onClick={() => resolve(conversationValue)}>
          Borrower said: {conversationValue}
        </Button>
      </div>
    </div>
  );
}
