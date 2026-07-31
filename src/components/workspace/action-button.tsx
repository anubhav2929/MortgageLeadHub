"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { ActionResult } from "@/domain/actions";

export function ActionButton({
  action,
  successOnly,
  onSuccess,
  children,
  ...props
}: Omit<ButtonProps, "onClick" | "loading"> & {
  action: () => Promise<ActionResult>;
  successOnly?: boolean;
  onSuccess?: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const { push } = useToast();
  const router = useRouter();

  return (
    <Button
      {...props}
      loading={isPending}
      onClick={() => {
        startTransition(async () => {
          const result = await action();
          if (result.ok) {
            push({ title: result.message, tone: "success" });
            onSuccess?.();
          } else if (!successOnly) {
            push({ title: "Action blocked", description: result.message, tone: "danger" });
          }
          router.refresh();
        });
      }}
    >
      {children}
    </Button>
  );
}
