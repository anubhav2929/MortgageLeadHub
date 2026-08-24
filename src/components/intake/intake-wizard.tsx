"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Home, RefreshCw, Wallet, RotateCcw, ShieldCheck } from "lucide-react";
import { cloneElement, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { CurrencyInput, Input, Label, Select } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { ReadMore } from "@/components/ui/read-more";
import { PostSubmitChat } from "@/components/intake/post-submit-chat";
import { discardIntakeDraftAction, saveIntakeDraftAction, submitIntakeAction, type IntakeInput } from "@/domain/actions";
import { STATE_NAMES } from "@/domain/stateTimezone";
import { FCRA_CREDIT_AUTHORIZATION_TEXT } from "@/core/creditGate";
import { STATE_CITIES, isKnownCity } from "@/domain/stateCities";
import { cn } from "@/lib/utils";
import { trackEvent } from "@/lib/analytics";
import type { LoanIntent } from "@/domain/types";

const STEPS = ["Purpose", "Property", "Your situation", "Contact", "Consent"];
const DRAFT_KEY = "mlh_intake_draft_v1";
const CLIENT_DRAFT_ID_KEY = "mlh_intake_draft_id_v1";
const DRAFT_SAVE_DEBOUNCE_MS = 2000;

/** Stable per-browser id for this in-progress inquiry — persisted
 *  alongside the form draft itself so repeated autosaves (and a page
 *  refresh mid-form) update the same server-side row instead of leaving a
 *  new one behind every time. */
function getOrCreateClientDraftId(): string {
  if (typeof window === "undefined") return "";
  try {
    const existing = window.localStorage.getItem(CLIENT_DRAFT_ID_KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    window.localStorage.setItem(CLIENT_DRAFT_ID_KEY, id);
    return id;
  } catch {
    return "";
  }
}

const INTENT_OPTIONS: { value: LoanIntent; label: string; description: string; icon: React.ElementType }[] = [
  { value: "REFINANCE", label: "Refinance", description: "Lower your rate, payment, or term", icon: RefreshCw },
  { value: "CASH_OUT", label: "Cash-out refinance", description: "Access equity as cash", icon: Wallet },
  { value: "HOME_EQUITY", label: "Home equity", description: "Borrow against your home's value", icon: Home },
];

const DISCLOSURES = {
  voice:
    "By checking this box, I consent to receive phone calls from Equity Flow Group and its licensed partners about my inquiry, including calls made using an automatic telephone dialing system, an artificial or prerecorded voice, or an AI voice assistant. Calls may be recorded for quality and compliance purposes, and I may request a human representative at any time.",
  sms: "By checking this box, I consent to receive text messages from Equity Flow Group and its licensed partners about my refinance or home equity inquiry, including messages sent using an automatic telephone dialing system. Message and data rates may apply. Consent is not a condition of purchase. Reply STOP to opt out at any time, HELP for help.",
  email: "By checking this box, I consent to receive email communications from Equity Flow Group about my inquiry.",
};

// Mirrors the server's normalizePhone() (submitIntakeAction) so a bad phone
// number is caught here, on the step where the field is visible — not
// discovered after the borrower has already moved on to Consent, where the
// resulting field error has nowhere on-screen to show up.
function isValidUsPhone(raw: string): boolean {
  const digits = raw.replace(/[^\d]/g, "");
  return digits.length === 10 || (digits.length === 11 && digits.startsWith("1"));
}

// Which step to jump back to when the server rejects a field. Contact moved
// to step 3 (the last data step) so borrowers answer three anonymous
// questions before being asked for a phone number — they are markedly more
// likely to hand it over once they have already invested the effort.
const FIELD_STEP: Record<string, number> = {
  stateCode: 1,
  timeline: 2,
  missedPayments: 2,
  firstName: 3,
  lastName: 3,
  phone: 3,
  email: 3,
};

const MISSED_PAYMENT_OPTIONS: { value: IntakeInput["missedPayments"]; label: string }[] = [
  { value: "NONE", label: "No missed payments" },
  { value: "ONE_TO_TWO", label: "1–2 missed payments" },
  { value: "THREE_PLUS", label: "3 or more missed payments" },
];

interface FormState {
  intent: LoanIntent | null;
  goal: IntakeInput["goal"] | null;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  stateCode: string;
  city: string;
  addressLine1: string;
  occupancy: IntakeInput["occupancy"];
  estimatedValue: string;
  currentBalance: string;
  hasExistingHomeEquityLoan: boolean | null;
  timeline: IntakeInput["timeline"] | null;
  creditRange: IntakeInput["creditRange"] | null;
  /** FCRA authorisation for the soft pull. Opt-in, never pre-ticked. */
  creditConsent: boolean;
  missedPayments: IntakeInput["missedPayments"] | null;
  bestContactTime: IntakeInput["bestContactTime"];
  voice: boolean;
  sms: boolean;
  email_: boolean;
}

const INITIAL: FormState = {
  intent: null,
  goal: null,
  firstName: "",
  lastName: "",
  phone: "",
  email: "",
  stateCode: "",
  city: "",
  addressLine1: "",
  occupancy: "PRIMARY",
  estimatedValue: "",
  currentBalance: "",
  hasExistingHomeEquityLoan: null,
  timeline: null,
  creditRange: null,
  creditConsent: false,
  missedPayments: null,
  bestContactTime: "ANY",
  // Unchecked by default — express written consent for an ATDS/prerecorded
  // channel should be an affirmative choice, not a pre-ticked box the
  // borrower has to notice and undo.
  voice: false,
  sms: false,
  email_: false,
};

function loadDraft(): { form: FormState; step: number } | null {
  if (typeof window === "undefined") return null;
  try {
    // Sensitive intake fields are never written to persistent localStorage.
    // sessionStorage supports refresh recovery in this tab and is discarded
    // when the browsing session ends; the encrypted/server retention path is
    // handled separately by saveIntakeDraftAction.
    const raw = window.sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.form) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** A labeled field with a consistent accessible id, wired error/hint text
 *  via aria-describedby, and an error announced via role="alert" — every
 *  Input/Select in this form goes through here instead of a bare Label
 *  floating unconnected above it. */
function Field({
  id,
  label,
  error,
  hint,
  children,
  className,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactElement<{ id?: string; "aria-invalid"?: boolean; "aria-describedby"?: string }>;
  className?: string;
}) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={className}>
      <Label htmlFor={id}>{label}</Label>
      {cloneWithA11y(children, id, describedBy, !!error)}
      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-1 text-xs text-[var(--danger)]">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1 text-xs text-[var(--muted-foreground)]">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function cloneWithA11y<P extends { id?: string; "aria-invalid"?: boolean; "aria-describedby"?: string }>(
  element: React.ReactElement<P>,
  id: string,
  describedBy: string | undefined,
  invalid: boolean
) {
  return cloneElement(element, { id, "aria-invalid": invalid || undefined, "aria-describedby": describedBy } as Partial<P>);
}

export function IntakeWizard({
  initialIntent,
  initialStateCode,
  initialEstimatedValue,
}: {
  initialIntent?: LoanIntent;
  initialStateCode?: string;
  initialEstimatedValue?: string;
}) {
  // Restore an interrupted session on mount — closing the tab or losing
  // signal mid-form no longer means starting over from Step 1. Resolved via
  // lazy initializers (not an effect) since it's a synchronous read of an
  // external system that should determine the very first render's state.
  const hasInitialParams = !!initialIntent || !!initialStateCode;
  const [restoredDraft, setRestoredDraft] = useState(() => hasInitialParams ? false : !!loadDraft());
  const [step, setStep] = useState(() => (hasInitialParams ? 0 : (loadDraft()?.step ?? 0)));
  const [form, setForm] = useState<FormState>(() => {
    const draft = hasInitialParams ? null : loadDraft();
    return {
      ...INITIAL,
      intent: initialIntent ?? INITIAL.intent,
      stateCode: initialStateCode ?? INITIAL.stateCode,
      estimatedValue: initialEstimatedValue ?? INITIAL.estimatedValue,
      ...(draft?.form ?? {}),
    };
  });
  const cityOptions = useMemo(() => STATE_CITIES[form.stateCode] ?? [], [form.stateCode]);
  // Lazy initializer, not a bare Date.now() argument — keeps this pure
  // during render while still capturing "when did this wizard mount" once.
  // Feeds S_Behavior's "fast completion" signal in lead quality scoring.
  const [startedAt] = useState(() => Date.now());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    publicRef: string;
    statusToken: string;
    slaDueAt: string;
    firstName: string;
    intent: LoanIntent;
    stateCode: string;
    city?: string;
    goal: IntakeInput["goal"];
    phone: string;
    email: string;
  } | null>(null);
  const [isPending, startTransition] = useTransition();
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const [clientDraftId] = useState(getOrCreateClientDraftId);
  const draftSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Persist on every change while the form is in progress; cleared on a
  // successful submit (see submit()) so a completed inquiry never resurfaces.
  // A tab-scoped copy supports refresh recovery; the debounced server-side
  // save provides the durable, retention-controlled draft. PII is not placed
  // in persistent browser localStorage.
  useEffect(() => {
    if (result || typeof window === "undefined") return;
    const hasAnyInput = form.firstName || form.lastName || form.phone || form.email || form.intent;
    if (!hasAnyInput) return;
    window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ form, step }));

    if (!clientDraftId) return;
    if (draftSaveTimer.current) clearTimeout(draftSaveTimer.current);
    draftSaveTimer.current = setTimeout(() => {
      saveIntakeDraftAction(clientDraftId, step, form as unknown as Record<string, unknown>);
    }, DRAFT_SAVE_DEBOUNCE_MS);
    return () => {
      if (draftSaveTimer.current) clearTimeout(draftSaveTimer.current);
    };
  }, [form, step, result, clientDraftId]);

  useEffect(() => {
    stepHeadingRef.current?.focus();
  }, [step]);

  // Fires once per mount, not once per step — a returning visitor picking
  // up a saved draft still only counts as one "started" for funnel math.
  useEffect(() => {
    trackEvent("intake_started");
  }, []);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function startOver() {
    window.sessionStorage.removeItem(DRAFT_KEY);
    // Best-effort — the visitor is gone either way, and the 30-day
    // retention purge (see purgeStaleIntakeDrafts) is the actual backstop
    // if this fails or the tab closes before it resolves.
    if (clientDraftId) {
      discardIntakeDraftAction(clientDraftId);
      window.localStorage.removeItem(CLIENT_DRAFT_ID_KEY);
    }
    setForm({ ...INITIAL, intent: initialIntent ?? null, stateCode: initialStateCode ?? "", estimatedValue: initialEstimatedValue ?? "" });
    setStep(0);
    setErrors({});
    setRestoredDraft(false);
  }

  function validateStep(s: number): Record<string, string> {
    const e: Record<string, string> = {};
    if (s === 0) {
      if (!form.intent) e.intent = "Select what you're looking to do.";
      if (!form.goal) e.goal = "Select your main goal.";
    } else if (s === 1) {
      if (!form.stateCode) e.stateCode = "Select your property's state.";
    } else if (s === 2) {
      if (!form.timeline) e.timeline = "Select a timeline.";
      if (!form.missedPayments) e.missedPayments = "Select an answer.";
      // Credit range is no longer asked. It comes from the soft pull at the
      // pre-qualification gate — self-reported scores were unreliable
      // (most people either don't know or overstate them).
    } else if (s === 3) {
      if (!form.firstName.trim()) e.firstName = "Enter your first name.";
      if (!form.lastName.trim()) e.lastName = "Enter your last name.";
      if (!isValidUsPhone(form.phone)) e.phone = "Enter a 10-digit US phone number.";
      if (!form.email.includes("@")) e.email = "Enter a valid email address.";
    }
    return e;
  }

  function next() {
    const stepErrors = validateStep(step);
    setErrors(stepErrors);
    if (Object.keys(stepErrors).length > 0) return;
    trackEvent("intake_step_completed", { step, step_name: STEPS[step] });
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  }
  function prev() {
    setErrors({});
    setStep((s) => Math.max(0, s - 1));
  }

  function submit() {
    const stepErrors = validateStep(step);
    if (Object.keys(stepErrors).length > 0) {
      setErrors(stepErrors);
      return;
    }
    startTransition(async () => {
      const res = await submitIntakeAction({
        intent: form.intent!,
        firstName: form.firstName,
        lastName: form.lastName,
        phone: form.phone,
        email: form.email,
        borrowerTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        stateCode: form.stateCode,
        city: form.city || undefined,
        addressLine1: form.addressLine1.trim() || undefined,
        occupancy: form.occupancy,
        estimatedValue: form.estimatedValue ? Number(form.estimatedValue) : undefined,
        currentBalance: form.currentBalance ? Number(form.currentBalance) : undefined,
        goal: form.goal!,
        timeline: form.timeline!,
        bestContactTime: form.bestContactTime,
        creditRange: form.creditRange ?? undefined,
        missedPayments: form.missedPayments!,
        hasExistingHomeEquityLoan: form.hasExistingHomeEquityLoan ?? undefined,
        intakeDurationSeconds: Math.round((Date.now() - startedAt) / 1000),
        consents: { voice: form.voice, sms: form.sms, email: form.email_, recording: form.voice },
        creditConsent: form.creditConsent,
      }, clientDraftId || undefined);
      if (res.ok && res.publicRef && res.statusToken && res.slaDueAt) {
        trackEvent("intake_submitted");
        setSubmitError(null);
        window.sessionStorage.removeItem(DRAFT_KEY);
        window.localStorage.removeItem(CLIENT_DRAFT_ID_KEY);
        if (draftSaveTimer.current) clearTimeout(draftSaveTimer.current);
        setResult({
          publicRef: res.publicRef,
          statusToken: res.statusToken,
          slaDueAt: res.slaDueAt,
          firstName: form.firstName,
          intent: form.intent!,
          stateCode: form.stateCode,
          city: form.city,
          goal: form.goal!,
          phone: form.phone,
          email: form.email,
        });
      } else {
        const fieldErrors = res.fieldErrors ?? {};
        setErrors(fieldErrors);
        // Never fail silently on the Consent step: jump back to whichever
        // earlier step actually owns the invalid field so its inline error
        // is visible, and show a banner either way.
        const firstErrorField = Object.keys(fieldErrors)[0];
        const targetStep = firstErrorField ? FIELD_STEP[firstErrorField] : undefined;
        if (targetStep !== undefined) setStep(targetStep);
        setSubmitError(
          firstErrorField ? "Please double-check the highlighted field before submitting." : "Something went wrong submitting your inquiry — your answers are still saved on this device. Please try again."
        );
      }
    });
  }

  if (result) {
    return (
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
        <PostSubmitChat
          publicRef={result.publicRef}
          statusToken={result.statusToken}
          slaDueAt={result.slaDueAt}
          firstName={result.firstName}
          intent={result.intent}
          goal={result.goal}
          stateCode={result.stateCode}
          city={result.city}
          phone={result.phone}
          email={result.email}
        />
      </motion.div>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-[var(--border)] px-6 py-4">
        <div className="mb-2 flex items-center justify-between text-xs font-medium text-[var(--muted-foreground)]">
          <span>
            Step {step + 1} of {STEPS.length}
          </span>
          <span aria-live="polite">{STEPS[step]}</span>
        </div>
        <Progress value={((step + 1) / STEPS.length) * 100} />
      </div>

      {restoredDraft && (
        <div className="flex items-center justify-between gap-3 border-b border-[var(--info-border)] bg-[var(--info-tint)] px-6 py-2.5 text-xs text-[var(--info)]">
          <span>Welcome back — we picked up where you left off.</span>
          <button onClick={startOver} className="focus-ring flex items-center gap-1 font-medium hover:underline">
            <RotateCcw className="h-3 w-3" /> Start over
          </button>
        </div>
      )}

      <div className="min-h-[380px] px-6 py-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          >
            {step === 0 && (
              <div>
                <h2 ref={stepHeadingRef} tabIndex={-1} className="mb-4 text-base font-semibold text-[var(--foreground)] focus:outline-none">
                  What are you looking to do?
                </h2>
                <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="What are you looking to do?">
                  {INTENT_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      role="radio"
                      aria-checked={form.intent === opt.value}
                      onClick={() => update("intent", opt.value)}
                      className={cn(
                        "focus-ring rounded-[var(--radius-md)] border p-4 text-left transition-all hover:shadow-[var(--shadow-sm)]",
                        form.intent === opt.value
                          ? "border-[var(--primary)] bg-[var(--primary-tint)] ring-1 ring-[var(--primary)]"
                          : "border-[var(--border-strong)] bg-[var(--surface)]"
                      )}
                    >
                      <opt.icon className={cn("mb-2 h-5 w-5", form.intent === opt.value ? "text-[var(--primary)]" : "text-[var(--muted-foreground)]")} />
                      <p className="text-[13px] font-medium text-[var(--foreground)]">{opt.label}</p>
                      <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">{opt.description}</p>
                    </button>
                  ))}
                </div>
                {errors.intent && (
                  <p role="alert" className="mt-2 text-xs text-[var(--danger)]">
                    {errors.intent}
                  </p>
                )}

                <Field id="goal" label="Main goal" error={errors.goal} className="mt-5">
                  <Select value={form.goal ?? ""} onChange={(e) => update("goal", e.target.value as FormState["goal"])}>
                    <option value="" disabled>
                      Select a goal
                    </option>
                    <option value="LOWER_PAYMENT">Lower my monthly payment</option>
                    <option value="CASH_OUT">Access cash</option>
                    <option value="SHORTEN_TERM">Shorten my loan term</option>
                    <option value="DEBT_CONSOLIDATION">Consolidate debt</option>
                    <option value="OTHER">Other</option>
                  </Select>
                </Field>
              </div>
            )}

            {step === 3 && (
              <div>
                <h2 ref={stepHeadingRef} tabIndex={-1} className="sr-only">
                  Contact information
                </h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field id="firstName" label="First name" error={errors.firstName}>
                    <Input autoComplete="given-name" value={form.firstName} onChange={(e) => update("firstName", e.target.value)} placeholder="Jordan" />
                  </Field>
                  <Field id="lastName" label="Last name" error={errors.lastName}>
                    <Input autoComplete="family-name" value={form.lastName} onChange={(e) => update("lastName", e.target.value)} placeholder="Ellis" />
                  </Field>
                  <Field
                    id="phone"
                    label="Phone"
                    error={errors.phone}
                    hint={!errors.phone && form.phone.trim() !== "" && !isValidUsPhone(form.phone) ? "Enter a 10-digit US phone number." : undefined}
                  >
                    <Input type="tel" autoComplete="tel" inputMode="tel" value={form.phone} onChange={(e) => update("phone", e.target.value)} placeholder="(555) 555-0142" />
                  </Field>
                  <Field id="email" label="Email" error={errors.email}>
                    <Input type="email" autoComplete="email" inputMode="email" value={form.email} onChange={(e) => update("email", e.target.value)} placeholder="you@example.com" />
                  </Field>
                  <Field id="bestContactTime" label="Best time to reach you">
                    <Select value={form.bestContactTime} onChange={(e) => update("bestContactTime", e.target.value as FormState["bestContactTime"])}>
                      <option value="ANY">Any time</option>
                      <option value="MORNING">Morning</option>
                      <option value="AFTERNOON">Afternoon</option>
                      <option value="EVENING">Evening</option>
                    </Select>
                  </Field>

                </div>
              </div>
            )}

            {step === 1 && (
              <div>
                <h2 ref={stepHeadingRef} tabIndex={-1} className="sr-only">
                  Property details
                </h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field id="addressLine1" label="Street address (optional)" hint="Helps us give you a more accurate property valuation." className="sm:col-span-2">
                    <Input autoComplete="address-line1" value={form.addressLine1} onChange={(e) => update("addressLine1", e.target.value)} placeholder="123 Main St" />
                  </Field>
                  <Field id="stateCode" label="Property state" error={errors.stateCode}>
                    <Select autoComplete="address-level1" value={form.stateCode} onChange={(e) => update("stateCode", e.target.value)}>
                      <option value="" disabled>
                        Select a state
                      </option>
                      {Object.entries(STATE_NAMES).map(([code, name]) => (
                        <option key={code} value={code}>
                          {name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field
                    id="city"
                    label="City"
                    hint={form.city.trim() && form.stateCode && !isKnownCity(form.stateCode, form.city) ? `Double-check that's in ${STATE_NAMES[form.stateCode]} — we didn't recognize it.` : undefined}
                  >
                    <Input autoComplete="address-level2" list="intake-city-options" value={form.city} onChange={(e) => update("city", e.target.value)} placeholder={form.stateCode ? cityOptions[0] ?? "City" : "Select a state first"} />
                  </Field>
                  <datalist id="intake-city-options">
                    {cityOptions.map((c) => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                  <Field id="occupancy" label="Occupancy">
                    <Select value={form.occupancy} onChange={(e) => update("occupancy", e.target.value as FormState["occupancy"])}>
                      <option value="PRIMARY">Primary residence</option>
                      <option value="SECOND_HOME">Second home</option>
                      <option value="INVESTMENT">Investment property</option>
                    </Select>
                  </Field>
                  <div />
                  <Field id="estimatedValue" label="Estimated value (optional)">
                    <CurrencyInput prefix="$" value={form.estimatedValue} onChange={(v) => update("estimatedValue", v)} placeholder="450,000" />
                  </Field>
                  <Field id="currentBalance" label="Current balance (optional)">
                    <CurrencyInput prefix="$" value={form.currentBalance} onChange={(v) => update("currentBalance", v)} placeholder="300,000" />
                  </Field>
                  {form.stateCode === "TX" && (form.intent === "CASH_OUT" || form.intent === "HOME_EQUITY") && (
                    <Field
                      id="hasExistingHomeEquityLoan"
                      label="Do you currently have an existing home equity loan or HELOC on this property?"
                      hint="Texas law limits a homeowner to one outstanding home equity loan at a time — this helps us route you correctly."
                      className="sm:col-span-2"
                    >
                      <Select
                        value={form.hasExistingHomeEquityLoan === null ? "" : form.hasExistingHomeEquityLoan ? "yes" : "no"}
                        onChange={(e) => update("hasExistingHomeEquityLoan", e.target.value === "" ? null : e.target.value === "yes")}
                      >
                        <option value="">Select an answer</option>
                        <option value="no">No</option>
                        <option value="yes">Yes</option>
                      </Select>
                    </Field>
                  )}
                </div>
              </div>
            )}

            {step === 2 && (
              <div>
                <h2 ref={stepHeadingRef} tabIndex={-1} className="sr-only">
                  Timeline and credit
                </h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field id="timeline" label="Timeline" error={errors.timeline}>
                    <Select value={form.timeline ?? ""} onChange={(e) => update("timeline", e.target.value as FormState["timeline"])}>
                      <option value="" disabled>
                        Select a timeline
                      </option>
                      <option value="ASAP">As soon as possible</option>
                      <option value="1_3_MONTHS">1–3 months</option>
                      <option value="3_6_MONTHS">3–6 months</option>
                    </Select>
                  </Field>
                  <Field id="missedPayments" label="Missed mortgage payments (last 12 months)" error={errors.missedPayments}>
                    <Select value={form.missedPayments ?? ""} onChange={(e) => update("missedPayments", e.target.value as FormState["missedPayments"])}>
                      <option value="" disabled>
                        Select an answer
                      </option>
                      {MISSED_PAYMENT_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
              </div>
            )}

            {step === 4 && (
              <div>
                <h2 ref={stepHeadingRef} tabIndex={-1} className="mb-1 text-base font-semibold text-[var(--foreground)] focus:outline-none">
                  How can we reach you?
                </h2>
                <p className="mb-4 text-[13px] text-[var(--muted-foreground)]">
                  You can decline any of these — declining won&apos;t stop us from reviewing your inquiry, but it will
                  limit how we can follow up.
                </p>
                <div className="space-y-3">
                  {(
                    [
                      { key: "voice" as const, label: "Phone calls (may include an AI assistant, recorded)", text: DISCLOSURES.voice },
                      { key: "sms" as const, label: "Text messages", text: DISCLOSURES.sms },
                      { key: "email_" as const, label: "Email", text: DISCLOSURES.email },
                    ]
                  ).map((c) => (
                    // The disclosure sits OUTSIDE the <label> so its Read more
                    // button cannot be swallowed by the label and silently tick
                    // the consent box. The full text stays in the DOM either
                    // way — ReadMore clamps visually, it does not truncate.
                    <div
                      key={c.key}
                      className="rounded-[var(--radius-md)] border border-[var(--border)] p-3.5 hover:bg-[var(--background)]"
                    >
                      <label className="flex cursor-pointer items-start gap-3">
                        <Checkbox checked={form[c.key]} onChange={(e) => update(c.key, e.target.checked)} className="mt-0.5" />
                        <span className="text-[13px] font-medium text-[var(--foreground)]">{c.label}</span>
                      </label>
                      <ReadMore text={c.text} lines={2} className="mt-1 pl-7" />
                    </div>
                  ))}
                </div>

                {/* Pre-qualification gate. The soft pull is billed per inquiry
                    and is a consumer report under FCRA, so it fires only when
                    the borrower crosses this gate deliberately — never
                    automatically from the name and address they typed earlier.
                    Unticked by default: a pre-ticked box is not authorisation. */}
                <div className="mt-5 rounded-[var(--radius-md)] border-2 border-[var(--primary)] bg-[var(--primary-tint)] p-4">
                  <p className="mb-1 flex items-center gap-1.5 text-[13px] font-semibold text-[var(--foreground)]">
                    <ShieldCheck className="h-4 w-4 text-[var(--primary)]" />
                    Want to see what you pre-qualify for?
                  </p>
                  <p className="mb-3 text-xs leading-relaxed text-[var(--muted-foreground)]">
                    Optional. Tick this and we&apos;ll check your credit with a{" "}
                    <strong className="text-[var(--foreground)]">soft inquiry</strong> so your officer can give you real
                    numbers on the first call instead of ranges.
                  </p>
                  <label className="flex cursor-pointer items-start gap-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3.5">
                    <Checkbox
                      checked={form.creditConsent}
                      onChange={(e) => update("creditConsent", e.target.checked)}
                      className="mt-0.5"
                    />
                    <span className="text-xs leading-relaxed text-[var(--muted-foreground)]">
                      {FCRA_CREDIT_AUTHORIZATION_TEXT}
                    </span>
                  </label>
                  <p className="mt-2 text-xs font-medium text-[var(--primary)]">
                    A soft inquiry will not affect your credit score.
                  </p>
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="border-t border-[var(--border)] px-6 py-4">
        {submitError && (
          <p role="alert" className="mb-3 rounded-[var(--radius-sm)] bg-[var(--danger-tint)] px-3 py-2 text-xs font-medium text-[var(--danger)]">
            {submitError}
          </p>
        )}
        {step === STEPS.length - 1 && (
          <>
            <p className="mb-2 text-xs leading-relaxed text-[var(--muted-foreground)]">
              This is an inquiry, not a loan application. Submitting this form does not affect your credit score and is
              not an approval or offer of credit. A licensed loan officer will follow up to discuss your options. See our{" "}
              <a href="/privacy" target="_blank" rel="noreferrer" className="font-medium text-[var(--primary)] hover:underline">
                Privacy Policy
              </a>{" "}
              and{" "}
              <a href="/terms" target="_blank" rel="noreferrer" className="font-medium text-[var(--primary)] hover:underline">
                Terms of Service
              </a>
              .
            </p>
            <p className="mb-3 text-xs leading-relaxed text-[var(--muted-foreground)]">
              <span className="font-medium text-[var(--foreground)]">Fair Credit Reporting Act:</span>{" "}
              we will not
              obtain your credit report unless you tick the pre-qualification box above. If you do, it is a soft
              inquiry that does not affect your score. Under the FCRA you have the right to know what&apos;s in your
              credit file, dispute inaccurate information, and obtain a copy of your report.
            </p>
          </>
        )}
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSubmitError(null);
              prev();
            }}
            disabled={step === 0}
          >
            <ChevronLeft className="h-3.5 w-3.5" /> Back
          </Button>
          {step === STEPS.length - 1 ? (
            <Button size="sm" loading={isPending} onClick={submit}>
              Submit inquiry
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => {
                setSubmitError(null);
                next();
              }}
            >
              Continue <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
