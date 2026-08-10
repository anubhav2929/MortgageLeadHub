import { Phone, MessageSquare, Mail, Globe, Bot, User, UserCheck, Cog } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDateTime } from "@/lib/utils";
import type { ThreadChannel, ThreadMessage, ThreadRole } from "@/core/conversationThread";

// Every channel, in one chronological thread. The officer used to have to
// reconstruct a lead's story from three places — sends in the timeline,
// voice transcripts in the conversation tab, borrower replies in notes.

const CHANNEL_ICON: Record<ThreadChannel, React.ElementType> = {
  VOICE: Phone,
  SMS: MessageSquare,
  EMAIL: Mail,
  PORTAL: Globe,
};

const CHANNEL_LABEL: Record<ThreadChannel, string> = {
  VOICE: "Call",
  SMS: "Text",
  EMAIL: "Email",
  PORTAL: "Status page",
};

const ROLE_ICON: Record<ThreadRole, React.ElementType> = {
  BORROWER: User,
  AGENT: Bot,
  OFFICER: UserCheck,
  SYSTEM: Cog,
};

const ROLE_LABEL: Record<ThreadRole, string> = {
  BORROWER: "Borrower",
  AGENT: "AI agent",
  OFFICER: "Loan officer",
  SYSTEM: "System",
};

export function UnifiedThread({ messages }: { messages: ThreadMessage[] }) {
  if (messages.length === 0) {
    return (
      <EmptyState
        icon={MessageSquare}
        title="Nothing sent or received yet"
        description="Calls, texts, emails, and status-page messages will all appear here in one thread."
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {messages.map((m) => {
        const ChannelIcon = CHANNEL_ICON[m.channel];
        const RoleIcon = ROLE_ICON[m.role];
        const inbound = m.direction === "INBOUND";
        return (
          <div key={m.id} className={`flex gap-3 ${inbound ? "" : "flex-row-reverse"}`}>
            <div
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                inbound
                  ? "bg-[var(--background)] text-[var(--muted-foreground)] ring-1 ring-[var(--border-strong)]"
                  : "bg-[var(--primary-tint)] text-[var(--primary)]"
              }`}
              title={ROLE_LABEL[m.role]}
            >
              <RoleIcon className="h-4 w-4" />
            </div>

            <div className={`min-w-0 max-w-[76%] ${inbound ? "" : "text-right"}`}>
              <div
                className={`flex items-center gap-1.5 text-[11px] text-[var(--muted-foreground)] ${
                  inbound ? "" : "justify-end"
                }`}
              >
                <ChannelIcon className="h-3 w-3" />
                <span>{CHANNEL_LABEL[m.channel]}</span>
                <span>·</span>
                <span>{ROLE_LABEL[m.role]}</span>
                <span>·</span>
                <span>{formatDateTime(m.at)}</span>
                {m.aiGenerated && m.role === "AGENT" && (
                  <>
                    <span>·</span>
                    <span className="font-medium text-[var(--primary)]">AI</span>
                  </>
                )}
              </div>

              <div
                className={`mt-1 inline-block rounded-[var(--radius-md)] px-3.5 py-2.5 text-left text-[13px] leading-relaxed ${
                  inbound
                    ? "bg-[var(--background)] text-[var(--foreground)] ring-1 ring-[var(--border)]"
                    : m.meta === "blocked"
                      ? "bg-[var(--warning-tint)] text-[var(--foreground)] ring-1 ring-[var(--warning-border)]"
                      : "bg-[var(--primary)] text-white"
                }`}
              >
                {m.subject && <p className="mb-1 font-semibold">{m.subject}</p>}
                <p className="whitespace-pre-wrap">{m.text}</p>
              </div>

              {(m.outcome || m.meta) && (
                <p className={`mt-1 text-[11px] text-[var(--muted-foreground)] ${inbound ? "" : "text-right"}`}>
                  {m.meta === "blocked" ? "Blocked by compliance rules" : m.outcome?.toLowerCase().replace(/_/g, " ")}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
