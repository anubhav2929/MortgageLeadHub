"use client";

import { Sparkles } from "lucide-react";
import { ActionButton } from "@/components/workspace/action-button";
import { runExtractionAction } from "@/domain/actions";

export function ExtractionButton({ publicRef }: { publicRef: string }) {
  return (
    <ActionButton action={() => runExtractionAction(publicRef)} variant="secondary" size="sm">
      <Sparkles className="h-3.5 w-3.5" /> Run AI extraction
    </ActionButton>
  );
}
