"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Phone, PhoneOff, Sparkles, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { startDialerCallAction, endDialerCallAction } from "@/domain/actions";
import type { AttemptOutcome } from "@/domain/types";

// "placed" rather than "connected": Twilio accepting the call tells us it was
// handed to the carrier, nothing more. Whether the borrower picked up is
// unknown until the officer logs it (or a status webhook lands), so the UI
// must not render a connected state it cannot verify.
type CallPhase = "dialing" | "ringing" | "placed" | "wrapup" | "blocked";

const OUTCOMES: AttemptOutcome[] = ["ANSWERED", "NO_ANSWER", "VOICEMAIL", "BUSY"];

/** Mount only while `open` is true — the parent conditionally renders this so
 *  every open is a fresh mount, which is what lets phase/elapsed/notes start
 *  from clean state without resetting them inside an effect. */
export function DialerModal({ publicRef, fullName, onClose }: { publicRef: string; fullName: string; onClose: () => void }) {
  const [phase, setPhase] = useState<CallPhase>("dialing");
  const [script, setScript] = useState("");
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [blockedMessage, setBlockedMessage] = useState("");
  const [blockedByPolicy, setBlockedByPolicy] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const [outcome, setOutcome] = useState<AttemptOutcome>("ANSWERED");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [simulated, setSimulated] = useState(false);
  const [mechanism, setMechanism] = useState<string | undefined>();
  const [strategyReason, setStrategyReason] = useState<string | undefined>();
  const [strategyRemedy, setStrategyRemedy] = useState<string | undefined>();
  const [degraded, setDegraded] = useState(false);
  const startedAt = useRef<number | null>(null);
  const hasStartedCall = useRef(false);
  const { push } = useToast();
  const router = useRouter();

  useEffect(() => {
    // React StrictMode double-invokes effects in dev, including a synthetic
    // mount → cleanup → mount cycle on the very first render. This effect has
    // a REAL side effect (places a call, writes an attempt), so the network
    // call itself must only ever fire once — guarded by the ref, which
    // (unlike a closure-local flag) survives that synthetic cleanup.
    if (hasStartedCall.current) return;
    hasStartedCall.current = true;

    startDialerCallAction(publicRef).then((result) => {
      if (!result.ok) {
        // Two different reasons a call doesn't happen, and the officer needs
        // to tell them apart: PolicyGate refusing (compliance — the lead is
        // fine, the timing or consent isn't) versus the provider failing
        // (our integration is broken). Labelling both "Blocked by
        // PolicyGate" sends someone to check consent when the real problem
        // is an API key.
        setBlockedByPolicy(result.message.startsWith("Blocked by PolicyGate"));
        setBlockedMessage(result.message.replace(/^Blocked by PolicyGate:\s*/, ""));
        setPhase("blocked");
        return;
      }
      setAttemptId(result.attemptId ?? null);
      setScript(result.script ?? "");
      setSimulated(Boolean(result.simulated));
      setMechanism(result.mechanism);
      setStrategyReason(result.strategyReason);
      setStrategyRemedy(result.strategyRemedy);
      setDegraded(Boolean(result.degraded));
      // The provider has accepted the call by the time this resolves, so move
      // straight to "placed" — the old 1.8s timer was a cosmetic delay that
      // implied a ring/answer sequence we never observed.
      startedAt.current = Date.now();
      setPhase("placed");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (phase !== "placed") return;
    const t = setInterval(() => {
      if (startedAt.current) setElapsed(Math.floor((Date.now() - startedAt.current) / 1000));
    }, 1000);
    return () => clearInterval(t);
  }, [phase]);

  function hangUp() {
    setPhase("wrapup");
  }

  function submitOutcome() {
    if (!attemptId) return;
    setSubmitting(true);
    endDialerCallAction(publicRef, attemptId, outcome, elapsed, notes).then((result) => {
      push({ title: result.message, tone: result.ok ? "success" : "danger" });
      setSubmitting(false);
      onClose();
      router.refresh();
    });
  }

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={phase === "placed" ? undefined : onClose} />
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="relative z-10 w-full max-w-sm overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-lg)]"
      >
        {phase === "blocked" ? (
          <div className="p-6 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--danger-tint)]">
              <ShieldAlert className="h-6 w-6 text-[var(--danger)]" />
            </div>
            <p className="text-[15px] font-semibold text-[var(--foreground)]">
              {blockedByPolicy ? "Blocked by PolicyGate" : "Call could not be placed"}
            </p>
            <p className="mt-1.5 text-[13px] text-[var(--muted-foreground)]">{blockedMessage}</p>
            <Button className="mt-5" variant="secondary" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        ) : phase === "wrapup" ? (
          <div className="p-6">
            <p className="mb-1 text-[15px] font-semibold text-[var(--foreground)]">Log the call</p>
            <p className="mb-4 text-[13px] text-[var(--muted-foreground)]">
              {mm}:{ss} since the call was placed — what was the outcome?
            </p>
            <Select value={outcome} onChange={(e) => setOutcome(e.target.value as AttemptOutcome)} className="mb-3">
              {OUTCOMES.map((o) => (
                <option key={o} value={o}>
                  {o.replace("_", " ")}
                </option>
              ))}
            </Select>
            <Textarea placeholder="Call notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={onClose}>
                Discard
              </Button>
              <Button size="sm" loading={submitting} onClick={submitOutcome}>
                Save call log
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center p-8 text-center">
            <AnimatePresence mode="wait">
              <motion.span
                key={phase}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                className={`flex h-20 w-20 items-center justify-center rounded-full ${
                  "bg-[var(--primary-tint)]"
                }`}
              >
                <Phone className={`h-8 w-8 text-[var(--primary)] ${phase !== "placed" ? "animate-pulse" : ""}`} />
              </motion.span>
            </AnimatePresence>

            <p className="mt-5 text-[16px] font-semibold text-[var(--foreground)]">{fullName}</p>
            <p className="mt-1 text-[13px] text-[var(--muted-foreground)]">
              {phase === "dialing" && "Checking PolicyGate…"}
              {phase === "ringing" && "Placing automated call…"}
              {phase === "placed" && (
                <>
                  {simulated
                    ? "Simulated — no voice provider connected"
                    : mechanism === "VAPI_AGENT"
                      ? "AI agent is on the call"
                      : "Recorded announcement playing"}{" "}
                  ·{" "}
                  <span className="mkt-mono tabular-nums">
                    {mm}:{ss}
                  </span>
                </>
              )}
            </p>

            {phase === "placed" && (degraded || script) && (
              <div
                className={`mt-5 w-full rounded-[var(--radius-md)] border p-3.5 text-left ${
                  degraded && !simulated
                    ? "border-[var(--warning)] bg-[var(--warning-tint)]"
                    : "border-[var(--border)] bg-[var(--background)]"
                }`}
              >
                <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                  {degraded ? <ShieldAlert className="h-3 w-3" /> : <Sparkles className="h-3 w-3" />}
                  {mechanism === "VAPI_AGENT"
                    ? "Live conversation"
                    : mechanism === "ANNOUNCEMENT"
                      ? "One-way announcement"
                      : "Nothing dialled"}
                </p>
                {script && <p className="text-[13px] leading-relaxed text-[var(--foreground)]">{script}</p>}
                {strategyReason && (
                  <p className={`${script ? "mt-2 " : ""}text-xs text-[var(--muted-foreground)]`}>{strategyReason}</p>
                )}
                {strategyRemedy && (
                  <p className="mt-1.5 text-xs font-medium text-[var(--foreground)]">{strategyRemedy}</p>
                )}
                {mechanism === "VAPI_AGENT" && !simulated && (
                  <p className="mt-2 text-xs text-[var(--muted-foreground)]">
                    The transcript lands on this lead automatically when the call ends — you don&apos;t need to log it
                    unless you want to add notes.
                  </p>
                )}
              </div>
            )}

            {phase === "placed" && (
              <div className="mt-6 flex items-center justify-center">
                <button
                  onClick={hangUp}
                  className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--danger)] text-white shadow-[var(--shadow-md)]"
                  title="Done — log the outcome"
                >
                  <PhoneOff className="h-5 w-5" />
                </button>
              </div>
            )}
          </div>
        )}
      </motion.div>
    </div>
  );
}
