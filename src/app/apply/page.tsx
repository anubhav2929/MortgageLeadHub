import { Landmark } from "lucide-react";
import { IntakeWizard } from "@/components/intake/intake-wizard";
import type { LoanIntent } from "@/domain/types";

interface PageProps {
  searchParams: Promise<{ intent?: string; stateCode?: string; estimatedValue?: string }>;
}

const VALID_INTENTS: LoanIntent[] = ["REFINANCE", "HOME_EQUITY", "CASH_OUT"];

export default async function ApplyPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const intent = VALID_INTENTS.includes(params.intent as LoanIntent) ? (params.intent as LoanIntent) : undefined;

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--background)]">
      <div className="mx-auto max-w-2xl px-6 py-12">
        <div className="mb-8 flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] bg-[var(--primary)] text-white">
            <Landmark className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-semibold text-[var(--foreground)]">MortgageLeadHub</p>
            <p className="text-xs text-[var(--muted-foreground)]">Refinance & equity inquiry</p>
          </div>
        </div>
        <IntakeWizard
          initialIntent={intent}
          initialStateCode={params.stateCode}
          initialEstimatedValue={params.estimatedValue}
        />
      </div>
    </div>
  );
}
