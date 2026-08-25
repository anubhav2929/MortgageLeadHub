"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { CheckCircle2, Phone, MessageSquare, Mail, Loader2, Clock, Send, UserCheck, ShieldCheck, Scale, ArrowRight } from "lucide-react";
import {
  initiateBorrowerChannelAction,
  requestPriorityCallbackAction,
  updateContactInfoAction,
  submitBorrowerMessageAction,
} from "@/domain/actions";
import { formatDateTime } from "@/lib/utils";
import type { Channel, GoalType, LoanIntent } from "@/domain/types";

const GOAL_PHRASE: Record<GoalType, string> = {
  LOWER_PAYMENT: "lower your monthly payment",
  CASH_OUT: "access some cash from your equity",
  SHORTEN_TERM: "shorten your loan term",
  DEBT_CONSOLIDATION: "simplify your monthly payments",
  OTHER: "get this sorted out",
};

const INTENT_PHRASE: Record<LoanIntent, string> = {
  REFINANCE: "a refinance",
  CASH_OUT: "a cash-out refinance",
  HOME_EQUITY: "a home equity loan",
  UNKNOWN: "financing",
};

const INTENT_LABEL: Record<LoanIntent, string> = {
  REFINANCE: "refinance",
  CASH_OUT: "cash-out refinance",
  HOME_EQUITY: "home equity",
  UNKNOWN: "financing",
};

type Sender = "agent" | "borrower";
interface Bubble {
  id: string;
  from: Sender;
  text: string;
}
type QuickReplyStage = "confirm" | "correcting" | "done" | null;
type BadgeState = "idle" | "loading" | "done" | "error";

export function PostSubmitChat({
  publicRef,
  statusToken,
  slaDueAt,
  firstName,
  intent,
  goal,
  stateCode,
  city,
  phone,
  email,
}: {
  publicRef: string;
  statusToken: string;
  slaDueAt: string;
  firstName: string;
  intent: LoanIntent;
  goal: GoalType;
  stateCode: string;
  city?: string;
  phone?: string;
  email?: string;
}) {
  const where = city ? `${city}, ${stateCode}` : stateCode;
  const displayName = firstName || "there";

  // --- Action badges: real, immediate, borrower-initiated first contact ---
  const [badgeState, setBadgeState] = useState<Record<Channel, BadgeState>>({ VOICE: "idle", SMS: "idle", EMAIL: "idle" });
  const [badgeMessage, setBadgeMessage] = useState<Record<Channel, string>>({ VOICE: "", SMS: "", EMAIL: "" });
  const [quietHoursBlocked, setQuietHoursBlocked] = useState(false);
  const [callbackRequested, setCallbackRequested] = useState(false);
  const [callbackSubmitting, setCallbackSubmitting] = useState(false);
  const inFlight = useRef<Partial<Record<Channel, boolean>>>({});

  function runChannel(channel: Channel) {
    if (inFlight.current[channel]) return;
    inFlight.current[channel] = true;
    setBadgeState((s) => ({ ...s, [channel]: "loading" }));
    initiateBorrowerChannelAction(publicRef, statusToken, channel).then((result) => {
      inFlight.current[channel] = false;
      setBadgeState((s) => ({ ...s, [channel]: result.ok ? "done" : "error" }));
      setBadgeMessage((m) => ({ ...m, [channel]: result.message }));
      if (!result.ok && result.blocked) setQuietHoursBlocked(true);
    });
  }

  function requestScheduledCallback() {
    if (callbackSubmitting || callbackRequested) return;
    setCallbackSubmitting(true);
    requestPriorityCallbackAction(publicRef, statusToken).then((result) => {
      setCallbackSubmitting(false);
      if (result.ok) setCallbackRequested(true);
    });
  }

  // --- Free-text "ask us anything" — always available, doesn't require
  // picking through the scripted quick replies first ---
  const [question, setQuestion] = useState("");
  const [questionSubmitting, setQuestionSubmitting] = useState(false);
  const [questionSent, setQuestionSent] = useState(false);
  // The exchange so far, so the borrower sees their own question and the
  // reply in place rather than a bare "sent" confirmation.
  const [qaLog, setQaLog] = useState<{ from: Sender; text: string }[]>([]);

  function submitQuestion() {
    const trimmed = question.trim();
    if (!trimmed || questionSubmitting) return;
    setQuestionSubmitting(true);
    setQaLog((prev) => [...prev, { from: "borrower", text: trimmed }]);
    setQuestion("");
    submitBorrowerMessageAction(publicRef, statusToken, trimmed).then((result) => {
      setQuestionSubmitting(false);
      if (result.ok) {
        setQuestionSent(true);
        // The action returns the assistant's actual reply (or an honest
        // "an officer will follow up" when no AI provider is configured).
        setQaLog((prev) => [...prev, { from: "agent", text: result.message }]);
      }
    });
  }

  // --- Correction path — "Not quite" opens editable phone/email fields
  // instead of a scripted dead end ---
  const [correctPhone, setCorrectPhone] = useState(phone ?? "");
  const [correctEmail, setCorrectEmail] = useState(email ?? "");
  const [correctSubmitting, setCorrectSubmitting] = useState(false);
  const [correctError, setCorrectError] = useState<string | null>(null);

  async function onSubmitCorrection() {
    setCorrectSubmitting(true);
    setCorrectError(null);
    const result = await updateContactInfoAction(publicRef, statusToken, correctPhone, correctEmail);
    setCorrectSubmitting(false);
    if (!result.ok) {
      setCorrectError(result.message);
      return;
    }
    setStage(null);
    push("borrower", "Updated my contact info");
    await say("Thanks — updated. Anything else, use the message box below and your officer will see it.", 550);
    setStage("done");
  }

  // --- Scripted recap chat: personalized from the form data on message one,
  // zero LLM calls (keeps per-lead API cost at zero for this step) ---
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [typing, setTyping] = useState(false);
  const [stage, setStage] = useState<QuickReplyStage>(null);
  const started = useRef(false);
  const idRef = useRef(0);

  function push(from: Sender, text: string) {
    idRef.current += 1;
    setBubbles((b) => [...b, { id: `b${idRef.current}`, from, text }]);
  }

  function say(text: string, delayMs: number): Promise<void> {
    setTyping(true);
    return new Promise((resolve) => {
      setTimeout(() => {
        setTyping(false);
        push("agent", text);
        resolve();
      }, delayMs);
    });
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      await say(`Hey ${displayName}, this is Morgan from Equity Flow Group 👋`, 450);
      await say(`Looks like you're looking to ${GOAL_PHRASE[goal]} with ${INTENT_PHRASE[intent]} in ${where} — did I get that right?`, 800);
      setStage("confirm");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onConfirm(yes: boolean) {
    push("borrower", yes ? "Yes, that's right" : "Not quite");
    setStage(null);
    if (yes) {
      await say("Perfect — pick whichever works best for you above and I'll get you moving, or keep chatting with me here.", 550);
      await say("While you wait, here’s exactly what you can expect from us — clear options, a licensed human, and no pressure to proceed.", 650);
      setStage("done");
    } else {
      await say("No problem — what's the best phone and email to reach you at?", 550);
      setStage("correcting");
    }
  }

  async function onQuickCallback() {
    push("borrower", "Just have someone call me later");
    setStage(null);
    await requestPriorityCallbackAction(publicRef, statusToken);
    await say(`Got it — flagged for a callback. A licensed loan officer will reach out by ${formatDateTime(slaDueAt)}.`, 600);
    setStage("done");
  }

  return (
    <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-sm)]">
      {/* Hero — renders instantly, no delay: the outcome-focused first screen */}
      <div className="border-b border-[var(--border)] bg-[var(--primary-tint)] px-5 py-5">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--primary)] text-white">
            <CheckCircle2 className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-[15px] font-semibold text-[var(--foreground)]">You&apos;re all set, {displayName}</p>
            <p className="mt-0.5 text-[13px] leading-relaxed text-[var(--foreground)]/80">
              We&apos;ve got your {INTENT_LABEL[intent]} inquiry for {where} — pick how you&apos;d like to hear from us below, or a licensed
              officer will reach out by <span className="font-medium">{formatDateTime(slaDueAt)}</span> either way.
            </p>
            <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--muted-foreground)]">
              <span className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" /> Reference <span className="font-mono font-medium text-[var(--foreground)]">{publicRef}</span>
              </span>
              <a href={`/status/${statusToken}`} target="_blank" rel="noreferrer" className="font-medium text-[var(--primary)] hover:underline">
                Bookmark your status page →
              </a>
            </p>
          </div>
        </div>
      </div>

      {/* Action badges — prominent, clickable, immediate feedback */}
      <div className="grid grid-cols-3 gap-2.5 border-b border-[var(--border)] px-5 py-4">
        <ActionBadge
          icon={Phone}
          label="Call me now"
          sublabel="Instant callback"
          state={badgeState.VOICE}
          resultMessage={badgeMessage.VOICE}
          onClick={() => runChannel("VOICE")}
        />
        <ActionBadge
          icon={MessageSquare}
          label="Text me"
          sublabel="Get a text"
          state={badgeState.SMS}
          resultMessage={badgeMessage.SMS}
          onClick={() => runChannel("SMS")}
        />
        <ActionBadge
          icon={Mail}
          label="Email me"
          sublabel="Send details"
          state={badgeState.EMAIL}
          resultMessage={badgeMessage.EMAIL}
          onClick={() => runChannel("EMAIL")}
        />
      </div>

      {quietHoursBlocked && (
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--warning-tint)] px-5 py-3">
          <p className="text-[12.5px] text-[var(--foreground)]">It&apos;s outside normal contact hours right now.</p>
          {callbackRequested ? (
            <span className="flex shrink-0 items-center gap-1.5 text-[12.5px] font-medium text-[var(--success)]">
              <CheckCircle2 className="h-3.5 w-3.5" /> Callback scheduled
            </span>
          ) : (
            <button
              onClick={requestScheduledCallback}
              disabled={callbackSubmitting}
              className="focus-ring shrink-0 rounded-full border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-1 text-[12.5px] font-medium text-[var(--foreground)] transition-colors hover:border-[var(--primary)] hover:text-[var(--primary)] disabled:opacity-60"
            >
              {callbackSubmitting ? "Scheduling…" : "Schedule a callback instead"}
            </button>
          )}
        </div>
      )}

      {/* Conversational thread — keeps the borrower engaged in-browser instead
          of a dead "submitted" screen, and confirms/corrects their answers */}
      <div className="flex flex-col gap-2.5 px-5 py-5">
        {bubbles.map((b) => (
          <motion.div
            key={b.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-relaxed ${
              b.from === "agent"
                ? "self-start rounded-bl-sm bg-[var(--background)] text-[var(--foreground)]"
                : "self-end rounded-br-sm bg-[var(--primary)] text-white"
            }`}
          >
            {b.text}
          </motion.div>
        ))}

        {typing && (
          <div className="flex items-center gap-1 self-start rounded-2xl rounded-bl-sm bg-[var(--background)] px-3.5 py-2.5">
            {[0, 1, 2].map((i) => (
              <motion.span
                key={i}
                className="h-1.5 w-1.5 rounded-full bg-[var(--muted-foreground)]"
                animate={{ opacity: [0.3, 1, 0.3] }}
                transition={{ duration: 1, repeat: Infinity, delay: i * 0.15 }}
              />
            ))}
          </div>
        )}

        {stage === "confirm" && (
          <div className="flex flex-wrap gap-2 self-end">
            <QuickReply onClick={() => onConfirm(true)}>Yes, that&apos;s right</QuickReply>
            <QuickReply onClick={() => onConfirm(false)}>Not quite</QuickReply>
            <QuickReply onClick={onQuickCallback}>Just call me later</QuickReply>
          </div>
        )}
        {stage === "correcting" && (
          <div className="w-full max-w-[85%] self-start rounded-xl border border-[var(--border)] bg-[var(--background)] p-3.5">
            <label className="mb-1 block text-xs font-medium text-[var(--muted-foreground)]">Phone</label>
            <input
              type="tel"
              value={correctPhone}
              onChange={(e) => setCorrectPhone(e.target.value)}
              placeholder="(555) 555-0142"
              className="mb-2.5 w-full rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface)] px-2.5 py-1.5 text-[13px] text-[var(--foreground)] focus-ring"
            />
            <label className="mb-1 block text-xs font-medium text-[var(--muted-foreground)]">Email</label>
            <input
              type="email"
              value={correctEmail}
              onChange={(e) => setCorrectEmail(e.target.value)}
              placeholder="you@example.com"
              className="mb-2.5 w-full rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface)] px-2.5 py-1.5 text-[13px] text-[var(--foreground)] focus-ring"
            />
            {correctError && <p className="mb-2.5 text-xs text-[var(--danger)]">{correctError}</p>}
            <div className="flex justify-end gap-2">
              <QuickReply onClick={() => setStage(null)}>Never mind</QuickReply>
              <button
                onClick={onSubmitCorrection}
                disabled={correctSubmitting}
                className="focus-ring rounded-full bg-[var(--primary)] px-3.5 py-1.5 text-[12.5px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {correctSubmitting ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        )}
        {stage === "done" && (
          <>
            <div className="mt-1 flex items-center gap-2 self-start rounded-xl border border-[var(--success)]/30 bg-[var(--success-tint)] px-3.5 py-2.5 text-[12.5px] font-medium text-[var(--success)]">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              You&apos;re all set — your officer can see this conversation and your stated preferences.
            </div>

            <div className="mt-3 w-full overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
              <div className="bg-[var(--primary-tint)] px-4 py-4">
                <p className="text-[13.5px] font-semibold text-[var(--foreground)]">Why borrowers choose Equity Flow Group</p>
                <p className="mt-1 text-xs leading-relaxed text-[var(--muted-foreground)]">
                  You stay in control while a licensed professional helps you compare the next step.
                </p>
              </div>
              <div className="grid gap-px bg-[var(--border)] sm:grid-cols-3">
                <TrustDetail icon={UserCheck} title="Licensed human guidance">
                  An officer reviews your goal and explains relevant options. You can request a human at any time.
                </TrustDetail>
                <TrustDetail icon={ShieldCheck} title="Privacy and consent first">
                  This inquiry does not trigger a hard credit check. Contact follows the permissions you selected, and you can opt out.
                </TrustDetail>
                <TrustDetail icon={Scale} title="Clear comparison, no obligation">
                  An inquiry is not an approval or commitment. Review terms and formal disclosures before deciding whether to proceed.
                </TrustDetail>
              </div>
              <div className="px-4 py-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">What happens next</p>
                <ol className="mt-3 grid gap-3 sm:grid-cols-3">
                  {[
                    ["1", "We verify the details you reported."],
                    ["2", "A licensed officer discusses suitable paths."],
                    ["3", "You decide whether any option is worth pursuing."],
                  ].map(([number, text]) => (
                    <li key={number} className="flex gap-2 text-xs leading-relaxed text-[var(--foreground)]">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--primary)] text-[10px] font-semibold text-white">{number}</span>
                      {text}
                    </li>
                  ))}
                </ol>
                <div className="mt-4 flex flex-wrap gap-2">
                  <a href="/tools" target="_blank" rel="noreferrer" className="focus-ring inline-flex items-center gap-1.5 rounded-full border border-[var(--border-strong)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] hover:border-[var(--primary)] hover:text-[var(--primary)]">
                    Explore free calculators <ArrowRight className="h-3.5 w-3.5" />
                  </a>
                  <a href="/mortgage-resources" target="_blank" rel="noreferrer" className="focus-ring inline-flex items-center gap-1.5 rounded-full border border-[var(--border-strong)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] hover:border-[var(--primary)] hover:text-[var(--primary)]">
                    Read mortgage guides <ArrowRight className="h-3.5 w-3.5" />
                  </a>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Persistent free-text channel to the officer — always available, not
          gated behind the scripted quick-reply flow above */}
      <div className="border-t border-[var(--border)] px-5 py-4">
        {qaLog.length > 0 && (
          <div className="mb-3 flex flex-col gap-2">
            {qaLog.map((m, i) => (
              <div
                key={i}
                className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-relaxed ${
                  m.from === "agent"
                    ? "self-start rounded-bl-sm bg-[var(--background)] text-[var(--foreground)]"
                    : "self-end rounded-br-sm bg-[var(--primary)] text-white"
                }`}
              >
                {m.text}
              </div>
            ))}
            {questionSubmitting && (
              <div className="flex items-center gap-1.5 self-start rounded-2xl rounded-bl-sm bg-[var(--background)] px-3.5 py-2.5 text-[13px] text-[var(--muted-foreground)]">
                <Loader2 className="h-3 w-3 animate-spin" /> Thinking…
              </div>
            )}
          </div>
        )}
        <label htmlFor="borrower-question" className="mb-1.5 block text-xs font-medium text-[var(--muted-foreground)]">
          Ask a question or tell us something
        </label>
        <div className="flex items-end gap-2">
          <textarea
            id="borrower-question"
            value={question}
            onChange={(e) => {
              setQuestion(e.target.value);
              if (questionSent) setQuestionSent(false);
            }}
            placeholder="e.g. What documents will I need?"
            rows={2}
            className="min-w-0 flex-1 resize-none rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--background)] px-2.5 py-2 text-[13px] text-[var(--foreground)] focus-ring"
          />
          <button
            onClick={submitQuestion}
            disabled={questionSubmitting || !question.trim()}
            aria-label="Send message"
            className="focus-ring flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--primary)] text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {questionSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
        {questionSent && (
          <p className="mt-1.5 flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
            <CheckCircle2 className="h-3.5 w-3.5 text-[var(--success)]" /> Your loan officer can see this conversation too.
          </p>
        )}
      </div>
    </div>
  );
}

function TrustDetail({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ElementType;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <details className="group bg-[var(--surface)] px-4 py-3.5 open:pb-4">
      <summary className="focus-ring flex cursor-pointer list-none items-center gap-2 rounded text-xs font-semibold text-[var(--foreground)]">
        <Icon className="h-4 w-4 shrink-0 text-[var(--primary)]" />
        <span className="flex-1">{title}</span>
        <span className="text-base leading-none text-[var(--muted-foreground)] transition-transform group-open:rotate-45">+</span>
      </summary>
      <p className="mt-2 text-[11.5px] leading-relaxed text-[var(--muted-foreground)]">{children}</p>
    </details>
  );
}

function ActionBadge({
  icon: Icon,
  label,
  sublabel,
  state,
  resultMessage,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  sublabel: string;
  state: BadgeState;
  resultMessage: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={state === "loading" || state === "done"}
      className={`focus-ring flex flex-col items-center gap-1.5 rounded-[var(--radius-md)] border px-2 py-3.5 text-center transition-all ${
        state === "done"
          ? "border-[var(--success)]/40 bg-[var(--success-tint)]"
          : state === "error"
            ? "border-[var(--danger)]/40 bg-[var(--danger-tint)]"
            : "border-[var(--border-strong)] bg-[var(--surface)] hover:border-[var(--primary)] hover:bg-[var(--primary-tint)]"
      }`}
    >
      {state === "loading" ? (
        <Loader2 className="h-5 w-5 animate-spin text-[var(--primary)]" />
      ) : state === "done" ? (
        <CheckCircle2 className="h-5 w-5 text-[var(--success)]" />
      ) : (
        <Icon className={`h-5 w-5 ${state === "error" ? "text-[var(--danger)]" : "text-[var(--primary)]"}`} />
      )}
      <span className="text-[12.5px] font-semibold text-[var(--foreground)]">{label}</span>
      <span className="text-[10.5px] leading-tight text-[var(--muted-foreground)]">
        {state === "idle" && sublabel}
        {state === "loading" && "Working…"}
        {(state === "done" || state === "error") && resultMessage}
      </span>
    </button>
  );
}

function QuickReply({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded-full border border-[var(--border-strong)] bg-[var(--surface)] px-3.5 py-1.5 text-[12.5px] font-medium text-[var(--foreground)] transition-colors hover:border-[var(--primary)] hover:text-[var(--primary)]"
    >
      {children}
    </button>
  );
}
