"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Save, AlertTriangle, ShieldAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { updateSystemConfigAction } from "@/domain/actions";
import type { SystemConfig } from "@/domain/types";

// Mirrors updateSystemConfigAction's own checks — surfaced here so an admin
// sees what's wrong (and Save is disabled) before round-tripping to the
// server, instead of discovering it only after clicking Save.
function validate(form: SystemConfig): string | null {
  if (form.firstContactSlaMinutes < 1 || form.dailyAttemptCap < 1 || form.minSpacingHours < 0) {
    return "SLA, attempt cap, and spacing must be positive.";
  }
  if (
    form.quietHoursStart < 0 ||
    form.quietHoursStart > 23 ||
    form.quietHoursEnd < 1 ||
    form.quietHoursEnd > 24 ||
    form.quietHoursStart >= form.quietHoursEnd
  ) {
    return "Quiet hours must be a valid 0-24 range with start before end.";
  }
  if (!form.senderName.trim() || !form.senderEmail.includes("@")) {
    return "Enter a sender name and a valid sender email.";
  }
  const w = form.scoringWeights;
  if (w.equity < 0 || w.margin < 0 || w.compliance < 0 || w.behavior < 0) {
    return "Scoring weights can't be negative.";
  }
  if (form.hotLeadThreshold < 1 || form.hotLeadThreshold > 100) {
    return "Hot-lead threshold must be between 1 and 100.";
  }
  const w2 = form.engagementWindowMinutes;
  if (w2 !== undefined && (Number.isNaN(w2) || w2 < 0 || w2 > 120)) {
    return "Live-chat hold must be between 0 and 120 minutes.";
  }
  return null;
}

const OVERRIDE_OPTIONS: {
  key: NonNullable<keyof NonNullable<SystemConfig["outreachOverrides"]>>;
  label: string;
  help: string;
}[] = [
  {
    key: "ignoreQuietHours",
    label: "Allow contact outside permitted local hours",
    help: "Calls and texts can go out at any hour in the borrower's own timezone, including Sundays and the stricter FL/WA/OR windows.",
  },
  {
    key: "ignoreAttemptCaps",
    label: "Allow exceeding the daily attempt cap",
    help: "A lead can be contacted more times per day than the cap above allows.",
  },
  {
    key: "ignoreMinSpacing",
    label: "Allow back-to-back attempts",
    help: "Removes the minimum wait between two consecutive touches on the same channel.",
  },
];

export function SettingsPanel({ config, canEdit }: { config: SystemConfig; canEdit: boolean }) {
  const [form, setForm] = useState(config);
  const [isPending, startTransition] = useTransition();
  const { push } = useToast();
  const router = useRouter();

  const validationError = useMemo(() => validate(form), [form]);
  const weightTotal = form.scoringWeights.equity + form.scoringWeights.margin + form.scoringWeights.compliance + form.scoringWeights.behavior;

  function update<K extends keyof SystemConfig>(key: K, value: SystemConfig[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function save() {
    if (validationError) return;
    startTransition(async () => {
      const result = await updateSystemConfigAction(form);
      push({ title: result.message, tone: result.ok ? "success" : "danger" });
      router.refresh();
    });
  }

  type NumericConfigKey = "firstContactSlaMinutes" | "dailyAttemptCap" | "minSpacingHours" | "quietHoursStart" | "quietHoursEnd";
  const FIELDS: { key: NumericConfigKey; label: string; help: string; min: number; max: number }[] = [
    { key: "firstContactSlaMinutes", label: "First-contact SLA (minutes)", help: "How fast a new lead must be attempted after submission.", min: 1, max: 60 },
    { key: "dailyAttemptCap", label: "Daily attempt cap (per channel)", help: "ATTEMPT_CAP_DAILY — max attempts on one channel per day.", min: 1, max: 10 },
    { key: "minSpacingHours", label: "Minimum spacing (hours)", help: "MIN_SPACING — cooldown between attempts on the same channel.", min: 0, max: 24 },
    { key: "quietHoursStart", label: "Quiet hours start (local, 24h)", help: "No automated contact before this hour, borrower's local time.", min: 0, max: 12 },
    { key: "quietHoursEnd", label: "Quiet hours end (local, 24h)", help: "No automated contact at or after this hour.", min: 12, max: 24 },
  ];

  type ScoringWeightKey = keyof SystemConfig["scoringWeights"];
  const SCORING_FIELDS: { key: ScoringWeightKey; label: string; help: string }[] = [
    { key: "equity", label: "Usable equity (LTV)", help: "S_Equity — full marks at LTV ≤70%, partial at 70-80%, none above." },
    { key: "margin", label: "Product margin", help: "S_Margin — cash-out/debt consolidation scores highest, then home equity, then rate & term." },
    { key: "compliance", label: "State licensing match", help: "S_Compliance — full marks in priority-licensed states, partial elsewhere licensed." },
    { key: "behavior", label: "Response urgency & speed", help: "S_Behavior — urgent intent plus a fast intake completion scores highest." },
  ];

  function updateWeight(key: ScoringWeightKey, value: number) {
    setForm((f) => ({ ...f, scoringWeights: { ...f.scoringWeights, [key]: value } }));
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Outreach sender identity</CardTitle>
            <CardDescription>
              The From name and address shown to borrowers on every email the team sends. Live as soon as a Resend
              key is saved under Integrations — until then, sends are simulated and logged with this identity.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-2">
          <div>
            <Label>Sender name</Label>
            <Input value={form.senderName} disabled={!canEdit} onChange={(e) => update("senderName", e.target.value)} placeholder="Equity Flow Group Team" />
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">Shown as the From display name.</p>
          </div>
          <div>
            <Label>Sender email</Label>
            <Input type="email" value={form.senderEmail} disabled={!canEdit} onChange={(e) => update("senderEmail", e.target.value)} placeholder="leads@yourdomain.com" />
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">Must be a verified domain in Resend once live.</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>PolicyGate configuration</CardTitle>
            <CardDescription>
              These values feed directly into the live gate — every call, text, and email checks against whatever is
              saved here. States with a stricter statutory quiet-hours window still override this default.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-2">
          {FIELDS.map((f) => (
            <div key={f.key}>
              <Label>{f.label}</Label>
              <Input
                type="number"
                min={f.min}
                max={f.max}
                value={form[f.key]}
                disabled={!canEdit}
                onChange={(e) => update(f.key, Number(e.target.value))}
              />
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">{f.help}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Lead quality scoring</CardTitle>
            <CardDescription>
              The 100-point model that predicts closing probability and routes hot leads to an instant officer
              transfer. Points should sum to 100, but nothing enforces that strictly if you want to experiment.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-2">
          {SCORING_FIELDS.map((f) => (
            <div key={f.key}>
              <Label>
                {f.label} <span className="text-[var(--muted-foreground)]">(max pts)</span>
              </Label>
              <Input
                type="number"
                min={0}
                max={100}
                value={form.scoringWeights[f.key]}
                disabled={!canEdit}
                onChange={(e) => updateWeight(f.key, Number(e.target.value))}
              />
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">{f.help}</p>
            </div>
          ))}
          <div className="sm:col-span-2">
            <p className={`text-[13px] font-medium ${weightTotal === 100 ? "text-[var(--success)]" : "text-[var(--warning)]"}`}>
              Total: {weightTotal} / 100
              {weightTotal !== 100 && " — doesn't sum to 100 (allowed, but scores won't map to a clean 0-100 scale)"}
            </p>
          </div>
          <div className="sm:col-span-2">
            <Label>Hot-lead threshold</Label>
            <Input
              type="number"
              min={1}
              max={100}
              value={form.hotLeadThreshold}
              disabled={!canEdit}
              onChange={(e) => update("hotLeadThreshold", Number(e.target.value))}
            />
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              Score strictly above this routes to an instant officer hot-transfer alert instead of the standard nurture flow.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Live-chat hold</CardTitle>
            <CardDescription>
              While a borrower is active in the post-submit chat, automated outreach holds off — texting someone who
              is already reading our chat costs money and tells them the channels aren&apos;t the same system. The
              step isn&apos;t dropped; it fires once the window lapses. Manual officer contact is never held.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <div className="max-w-xs">
            <Label htmlFor="engagementWindow">Hold automated outreach for (minutes)</Label>
            <Input
              id="engagementWindow"
              type="number"
              min={0}
              max={120}
              disabled={!canEdit}
              value={form.engagementWindowMinutes ?? 5}
              onChange={(e) => update("engagementWindowMinutes", Number(e.target.value))}
            />
            <p className="mt-1.5 text-xs text-[var(--muted-foreground)]">
              Set to 0 to disable the hold entirely.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Environment banner</CardTitle>
            <CardDescription>
              The dark strip at the top of every page. Its wording is derived from which integrations are actually
              configured — it names the live channels and the simulated ones, so it can&apos;t claim &ldquo;nothing is
              real&rdquo; once a carrier key is in place. Turn it off for a clean client demo or a production site.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <label className="flex cursor-pointer items-start gap-3 rounded-[var(--radius-md)] border border-[var(--border)] p-3">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-[var(--primary)]"
              disabled={!canEdit}
              checked={form.showEnvironmentBanner !== false}
              onChange={(e) => update("showEnvironmentBanner", e.target.checked)}
            />
            <span>
              <span className="block text-[13px] font-medium text-[var(--foreground)]">Show the environment banner</span>
              <span className="block text-xs text-[var(--muted-foreground)]">
                Hiding it changes nothing about what the app does — it does not make simulated channels live, or live
                channels safe. It only stops displaying the notice.
              </span>
            </span>
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle className="flex items-center gap-1.5">
              <ShieldAlert className="h-3.5 w-3.5 text-[var(--warning)]" /> Manual outreach overrides
            </CardTitle>
            <CardDescription>
              Lets an admin or officer contact a lead outside the normal pacing rules — off by default. These apply
              only to a person clicking Call, Text, or Email. Automated cadence steps never inherit them, because an
              unattended dialer running at 3am is a different kind of risk than a human deciding to make one late call.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {OVERRIDE_OPTIONS.map((opt) => (
            <label
              key={opt.key}
              className="flex cursor-pointer items-start gap-3 rounded-[var(--radius-md)] border border-[var(--border)] p-3"
            >
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-[var(--warning)]"
                disabled={!canEdit}
                checked={Boolean(form.outreachOverrides?.[opt.key])}
                onChange={(e) =>
                  update("outreachOverrides", { ...form.outreachOverrides, [opt.key]: e.target.checked })
                }
              />
              <span>
                <span className="block text-[13px] font-medium text-[var(--foreground)]">{opt.label}</span>
                <span className="block text-xs text-[var(--muted-foreground)]">{opt.help}</span>
              </span>
            </label>
          ))}

          <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--background)] p-3">
            <p className="text-xs font-medium text-[var(--foreground)]">What these can never override</p>
            <p className="mt-1 text-xs leading-relaxed text-[var(--muted-foreground)]">
              Opt-outs and STOP replies, the suppression and DNC list, missing or revoked consent, the global kill
              switch, and closed or suppressed leads. Those are legal bars, not pacing preferences, and no setting in
              this app can switch them off. Every override change is written to the audit log with your name.
            </p>
          </div>
        </CardContent>
      </Card>

      {canEdit && (
        <div className="flex items-center justify-end gap-3">
          {validationError && (
            <p className="flex items-center gap-1.5 text-[13px] font-medium text-[var(--danger)]">
              <AlertTriangle className="h-3.5 w-3.5" /> {validationError}
            </p>
          )}
          <Button size="sm" loading={isPending} disabled={!!validationError} onClick={save}>
            <Save className="h-3.5 w-3.5" /> Save settings
          </Button>
        </div>
      )}
    </div>
  );
}
