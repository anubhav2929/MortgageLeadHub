"use client";

import { Search } from "lucide-react";
import { ActionButton } from "@/components/workspace/action-button";
import { runLeadDiscoveryAction } from "@/domain/actions";

export function RunDiscoveryButton() {
  return (
    <ActionButton action={() => runLeadDiscoveryAction()} variant="primary" size="sm">
      <Search className="h-3.5 w-3.5" /> Run discovery
    </ActionButton>
  );
}
