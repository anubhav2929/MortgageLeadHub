import { AlertTriangle, Bot, ChevronDown, FileText, Globe, Mail, MessageSquare, Phone, User } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { ExtractionButton } from "@/components/workspace/extraction-button";
import { formatDateTime } from "@/lib/utils";
import { UnifiedThread } from "@/components/workspace/unified-thread";
import type { ThreadMessage } from "@/core/conversationThread";
import type { ConversationSession, FieldCandidate } from "@/domain/types";

export function ConversationTab({
  publicRef,
  conversations,
  candidates,
  thread,
}: {
  publicRef: string;
  conversations: ConversationSession[];
  candidates: FieldCandidate[];
  thread: ThreadMessage[];
}) {
  if (thread.length === 0 && conversations.length === 0) {
    return <EmptyState icon={Bot} title="No conversation yet" description="Calls, texts, emails, and status-page messages will appear here once the borrower is reached." />;
  }

  const sources = [
    { channel: "PORTAL", label: "Lead & portal", icon: Globe },
    { channel: "SMS", label: "Texts", icon: MessageSquare },
    { channel: "EMAIL", label: "Emails", icon: Mail },
    { channel: "VOICE", label: "Calls", icon: Phone },
  ] as const;

  return (
    <div className="space-y-4">
      {/* Every channel in one chronological thread — see core/conversationThread.ts */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Conversation</CardTitle>
            <CardDescription>Every call, text, email, and status-page message with this borrower, in order.</CardDescription>
          </div>
          <ExtractionButton publicRef={publicRef} />
        </CardHeader>
        <CardContent>
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Conversation sources">
            {sources.map(({ channel, label, icon: Icon }) => {
              const count = thread.filter((message) => message.channel === channel).length;
              return (
                <div key={channel} className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--background)] px-3 py-2">
                  <Icon className="h-3.5 w-3.5 text-[var(--primary)]" />
                  <div>
                    <p className="text-[11px] text-[var(--muted-foreground)]">{label}</p>
                    <p className="text-sm font-semibold text-[var(--foreground)]">{count}</p>
                  </div>
                </div>
              );
            })}
          </div>
          <UnifiedThread messages={thread} />
        </CardContent>
      </Card>

      {conversations.length > 0 && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle className="flex items-center gap-1.5"><FileText className="h-4 w-4" /> Call transcripts</CardTitle>
              <CardDescription>Vapi call artifacts, summaries, and speaker-attributed turns. Expand a call to inspect it.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {conversations
              .slice()
              .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
              .map((conv) => (
              <details key={conv.id} className="group rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]">
                <summary className="focus-ring flex cursor-pointer list-none items-center justify-between gap-3 rounded-[var(--radius-md)] p-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[13px] font-semibold text-[var(--foreground)]">{formatDateTime(conv.startedAt)}</p>
                      <Badge tone={conv.transcript.length > 0 ? "success" : "neutral"}>{conv.transcript.length} turns</Badge>
                      <Badge tone="neutral">{conv.transcriptSource === "VAPI_ARTIFACT" ? "Vapi final" : conv.transcriptSource === "LIVE_EVENTS" ? "Vapi live" : conv.transcript.length > 0 ? "Stored transcript" : "Awaiting artifact"}</Badge>
                      {conv.escalated && <Badge tone="warning">Escalated</Badge>}
                    </div>
                    <p className="mt-1 truncate text-xs text-[var(--muted-foreground)]">
                      {conv.summary || (conv.transcript.length > 0 ? conv.transcript[0].text : `Call ${conv.status.toLowerCase().replace("_", " ")}`)}
                    </p>
                  </div>
                  <ChevronDown className="h-4 w-4 shrink-0 text-[var(--muted-foreground)] transition-transform group-open:rotate-180" />
                </summary>
                <div className="border-t border-[var(--border)] p-3">
                  <p className="mb-3 text-[11px] text-[var(--muted-foreground)]">
                    {conv.status.toLowerCase().replace("_", " ")} · prompt {conv.promptVersionId}
                    {conv.recordingAvailable ? " · recording available" : ""}
                    {conv.callLogAvailable ? " · provider log available" : ""}
                    {conv.redactionApplied ? " · sensitive text redacted" : ""}
                  </p>
                  {conv.escalated && conv.escalationReason && (
                    <div className="mb-3 flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--warning-border)] bg-[var(--warning-tint)] p-3 text-[13px] text-[var(--warning)]">
                      <AlertTriangle className="h-4 w-4 shrink-0" />{conv.escalationReason}
                    </div>
                  )}
                  {conv.summary && <div className="mb-4 rounded-[var(--radius-md)] bg-[var(--background)] p-3"><p className="mb-1 text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">Summary</p><p className="text-[13px] text-[var(--foreground)]">{conv.summary}</p></div>}
                  {conv.transcript.length === 0 ? (
                    <p className="text-xs text-[var(--muted-foreground)]">No transcript artifact has arrived yet. The reconciliation worker will pull it from Vapi after the call ends.</p>
                  ) : (
                    <div className="space-y-2.5">
                      {conv.transcript.map((turn) => (
                        <div key={`${conv.id}-${turn.turn}`} className={`flex gap-2.5 ${turn.role === "BORROWER" ? "flex-row-reverse" : ""}`}>
                          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${turn.role === "AGENT" ? "bg-[var(--primary-tint)] text-[var(--primary)]" : "bg-[var(--violet-tint)] text-[var(--violet)]"}`}>
                            {turn.role === "AGENT" ? <Bot className="h-3.5 w-3.5" /> : <User className="h-3.5 w-3.5" />}
                          </span>
                          <div className={`max-w-md rounded-[var(--radius-md)] px-3.5 py-2 text-[13px] ${turn.role === "AGENT" ? "bg-[var(--background)] text-[var(--foreground)]" : "bg-[var(--primary)] text-white"}`}>{turn.text}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </details>
            ))}
          </CardContent>
        </Card>
      )}

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
