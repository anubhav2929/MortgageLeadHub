import { AlertTriangle, Bot, User } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { ExtractionButton } from "@/components/workspace/extraction-button";
import { formatDateTime } from "@/lib/utils";
import type { ConversationSession, FieldCandidate } from "@/domain/types";

export function ConversationTab({
  publicRef,
  conversations,
  candidates,
}: {
  publicRef: string;
  conversations: ConversationSession[];
  candidates: FieldCandidate[];
}) {
  if (conversations.length === 0) {
    return <EmptyState icon={Bot} title="No conversation yet" description="Transcript and extraction results will appear once the borrower is reached." />;
  }

  return (
    <div className="space-y-4">
      {conversations.map((conv) => (
        <Card key={conv.id}>
          <CardHeader>
            <div>
              <CardTitle>
                {conv.channel} conversation · {conv.status.toLowerCase().replace("_", " ")}
              </CardTitle>
              <CardDescription>
                Started {formatDateTime(conv.startedAt)} · prompt version {conv.promptVersionId}
                {conv.redactionApplied ? " · redaction applied" : ""}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {conv.escalated && <Badge tone="warning">Escalated</Badge>}
              <ExtractionButton publicRef={publicRef} />
            </div>
          </CardHeader>
          <CardContent>
            {conv.escalated && conv.escalationReason && (
              <div className="mb-3 flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--warning-border)] bg-[var(--warning-tint)] p-3 text-[13px] text-[var(--warning)]">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                {conv.escalationReason}
              </div>
            )}
            {conv.summary && (
              <div className="mb-4 rounded-[var(--radius-md)] bg-[var(--background)] p-3">
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">Summary</p>
                <p className="text-[13px] text-[var(--foreground)]">{conv.summary}</p>
              </div>
            )}
            <div className="space-y-2.5">
              {conv.transcript.map((turn) => (
                <div key={turn.turn} className={`flex gap-2.5 ${turn.role === "BORROWER" ? "flex-row-reverse" : ""}`}>
                  <span
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                      turn.role === "AGENT" ? "bg-[var(--primary-tint)] text-[var(--primary)]" : "bg-[var(--violet-tint)] text-[var(--violet)]"
                    }`}
                  >
                    {turn.role === "AGENT" ? <Bot className="h-3.5 w-3.5" /> : <User className="h-3.5 w-3.5" />}
                  </span>
                  <div
                    className={`max-w-md rounded-[var(--radius-md)] px-3.5 py-2 text-[13px] ${
                      turn.role === "AGENT"
                        ? "bg-[var(--background)] text-[var(--foreground)]"
                        : "bg-[var(--primary)] text-white"
                    }`}
                  >
                    {turn.text}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}

      {candidates.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Extracted field candidates</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {candidates.map((c) => (
              <div key={c.id} className="flex items-center justify-between border-b border-[var(--border)] pb-2 text-[13px] last:border-b-0 last:pb-0">
                <div>
                  <span className="font-medium text-[var(--foreground)]">{c.fieldPath}</span>
                  <span className="ml-2 text-[var(--muted-foreground)]">= {String(c.value)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[var(--muted-foreground)]">
                    {Math.round(c.confidence * 100)}% · turns [{c.transcriptTurnRefs.join(", ") || "none"}]
                  </span>
                  <Badge tone={c.promoted ? "success" : "neutral"}>{c.promoted ? "Promoted" : "Not promoted"}</Badge>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
