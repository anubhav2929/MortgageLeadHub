"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { disconnectRedditAction } from "@/domain/actions";

export function RedditConnectionControls({ accountName, approved }: { accountName?: string; approved: boolean }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const { push } = useToast();
  if (!approved) return null;
  if (!accountName) return <a className="focus-ring inline-flex h-8 items-center rounded-md border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-[13px] font-medium text-[var(--foreground)]" href="/api/integrations/reddit/connect">Connect Reddit</a>;
  return (
    <Button size="sm" variant="ghost" loading={pending} onClick={() => startTransition(async () => {
      const result = await disconnectRedditAction();
      push({ title: result.message, tone: result.ok ? "success" : "danger" });
      if (result.ok) router.refresh();
    })}>Disconnect u/{accountName}</Button>
  );
}
