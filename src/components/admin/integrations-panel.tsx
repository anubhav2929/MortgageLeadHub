"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, CheckCircle2, ChevronDown, ChevronRight, CircleDashed, Copy, ExternalLink, Loader2, Lock, Plug, ShieldAlert, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { INTEGRATIONS, isSecretKey, type IntegrationCategory } from "@/core/integrationRegistry";
import { saveIntegrationKeysAction, testIntegrationAction, type IntegrationStatus } from "@/domain/integrationActions";
import { formatDateTime } from "@/lib/utils";
import type { FailedAttemptItem } from "@/domain/queries";
import { normalizePublicAppUrl } from "@/core/publicUrl";

const CATEGORY_ORDER: IntegrationCategory[] = ["Messaging", "AI", "Voice AI", "Data", "Platform"];

export function IntegrationsPanel({
  statuses,
  storageEnabled,
  canEdit,
  recentFailures,
  publicEndpoints,
}: {
  statuses: IntegrationStatus[];
  storageEnabled: boolean;
  canEdit: boolean;
  recentFailures: FailedAttemptItem[];
  publicEndpoints: {
    appUrl: string;
    source: string;
    warning?: string;
    telnyxPrimary: string;
    telnyxFailover: string;
    vapi: string;
    resendDelivery: string;
    resendInbound: string;
  };
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const statusById = new Map(statuses.map((s) => [s.id, s]));

  const liveCount = statuses.filter((s) => s.live && s.id !== "platform").length;
  const totalCount = INTEGRATIONS.filter((i) => i.id !== "platform").length;

  return (
    <div className="space-y-4">
      {!storageEnabled && (
        <div className="flex items-start gap-3 rounded-[var(--radius-md)] border border-[var(--warning-border)] bg-[var(--warning-tint)] px-4 py-3.5">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-[var(--warning)]" />
          <div className="text-[13px] leading-relaxed text-[var(--foreground)]">
            <p className="font-semibold">Set CREDENTIAL_SECRET before saving keys here.</p>
            <p className="mt-1 text-[var(--muted-foreground)]">
              Provider keys are encrypted before they&apos;re written to the database, and that needs one root secret
              that <em>isn&apos;t</em> stored alongside them. Add an environment variable called{" "}
              <code className="rounded bg-[var(--background)] px-1 py-0.5 font-mono text-[11.5px]">CREDENTIAL_SECRET</code>{" "}
              set to any random string of 32+ characters, then redeploy. Generate one with{" "}
              <code className="rounded bg-[var(--background)] px-1 py-0.5 font-mono text-[11.5px]">openssl rand -hex 32</code>.
            </p>
            <p className="mt-1.5 text-[var(--muted-foreground)]">
              Until then you can still configure everything through environment variables directly — this panel will
              show those as read-only.
            </p>
          </div>
        </div>
      )}

      <div className="flex items-start gap-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--background)] px-4 py-3.5">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-[var(--primary)]" />
        <div className="text-[13px] leading-relaxed text-[var(--muted-foreground)]">
          <span className="font-semibold text-[var(--foreground)]">
            {liveCount} of {totalCount} integrations live.
          </span>{" "}
          Every provider simulates until its keys are here — nothing bills, and no real message goes out. Saving a key
          takes effect on the very next send; there&apos;s no redeploy and no restart.
        </div>
      </div>

      {CATEGORY_ORDER.map((category) => {
        const defs = INTEGRATIONS.filter((i) => i.category === category);
        if (defs.length === 0) return null;
        return (
          <div key={category}>
            <p className="mb-2 mt-5 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
              {category}
            </p>
            <div className="flex flex-col gap-2.5">
              {defs.map((def) => (
                <IntegrationRow
                  key={def.id}
                  def={def}
                  status={statusById.get(def.id)}
                  open={openId === def.id}
                  onToggle={() => setOpenId(openId === def.id ? null : def.id)}
                  canEdit={canEdit && storageEnabled}
                  endpoints={
                    def.id === "telnyx" ? [
                      { label: "Webhook URL", url: publicEndpoints.telnyxPrimary },
                      { label: "Webhook Failover URL", url: publicEndpoints.telnyxFailover },
                    ] : def.id === "vapi" ? [
                      { label: "Server and tool webhook URL", url: publicEndpoints.vapi },
                    ] : def.id === "resend" ? [
                      { label: "Delivery webhook URL", url: publicEndpoints.resendDelivery },
                      { label: "Inbound email webhook URL", url: publicEndpoints.resendInbound },
                    ] : def.id === "platform" ? [
                      { label: `Effective production origin (${publicEndpoints.source})`, url: publicEndpoints.appUrl },
                    ] : undefined
                  }
                  endpointWarning={def.id === "platform" ? publicEndpoints.warning : undefined}
                />
              ))}
            </div>
          </div>
        );
      })}

      {recentFailures.length > 0 && (
        <Card>
          <CardContent className="p-5">
            <p className="mb-2 text-[13px] font-semibold text-[var(--foreground)]">Recent provider failures</p>
            <p className="mb-2.5 text-[12px] text-[var(--muted-foreground)]">
              Sends that failed at the provider — usually a wrong key, an unverified trial number, or a suspended account.
            </p>
            <div className="flex flex-col gap-1.5">
              {recentFailures.slice(0, 6).map((f, i) => (
                <div key={`${f.leadPublicRef}-${i}`} className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-[12.5px]">
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate font-medium text-[var(--foreground)]">
                      {f.leadFullName} · {f.channel.toLowerCase()}
                    </span>
                    <span className="shrink-0 text-[var(--muted-foreground)]">{formatDateTime(f.scheduledFor)}</span>
                  </div>
                  {f.failureMessage && (
                    <p className="mt-1 break-words text-[12px] leading-relaxed text-[var(--muted-foreground)]">
                      {f.failureClass ? `${f.failureClass.toLowerCase()}: ` : ""}{f.failureMessage}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function IntegrationRow({
  def,
  status,
  open,
  onToggle,
  canEdit,
  endpoints,
  endpointWarning,
}: {
  def: (typeof INTEGRATIONS)[number];
  status?: IntegrationStatus;
  open: boolean;
  onToggle: () => void;
  canEdit: boolean;
  endpoints?: Array<{ label: string; url: string }>;
  endpointWarning?: string;
}) {
  const { push } = useToast();
  const router = useRouter();
  const [isSaving, startSave] = useTransition();
  const [testing, setTesting] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const f of def.fields) init[f.key] = status?.fields.find((x) => x.key === f.key)?.display ?? "";
    return init;
  });

  const live = status?.live ?? false;
  const isPlatform = def.id === "platform";

  function save() {
    const nextValues = { ...values };
    if (def.id === "platform" && nextValues.APP_URL?.trim()) {
      const normalized = normalizePublicAppUrl(nextValues.APP_URL);
      if (normalized.ok) {
        nextValues.APP_URL = normalized.url;
        setValues(nextValues);
      }
    }
    startSave(async () => {
      const result = await saveIntegrationKeysAction(def.id, nextValues);
      push({ title: result.message, tone: result.ok ? "success" : "danger" });
      if (result.ok) router.refresh();
    });
  }

  async function copyEndpoint(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(url);
      window.setTimeout(() => setCopiedUrl((current) => current === url ? null : current), 1600);
    } catch {
      push({ title: "Could not copy automatically. Select the URL and copy it manually.", tone: "danger" });
    }
  }

  async function runTest() {
    setTesting(true);
    const result = await testIntegrationAction(def.id);
    setTesting(false);
    push({ title: result.message, tone: result.ok ? "success" : "danger" });
    router.refresh();
  }

  return (
    <Card>
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="focus-ring flex w-full items-center justify-between gap-3 rounded-[var(--radius-lg)] px-5 py-4 text-left"
      >
        <span className="flex min-w-0 items-center gap-3">
          {open ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
          )}
          <span className="min-w-0">
            <span className="flex items-center gap-2">
              <span className="text-[14px] font-semibold text-[var(--foreground)]">{def.name}</span>
              {def.freeTier && <Badge tone="neutral">{def.freeTier}</Badge>}
            </span>
            <span className="mt-0.5 block truncate text-[12.5px] text-[var(--muted-foreground)]">{def.powers}</span>
          </span>
        </span>
        <span className="shrink-0">
          {isPlatform ? (
            <Badge tone="neutral">Settings</Badge>
          ) : live ? (
            <Badge tone="success">
              <CheckCircle2 className="mr-1 inline h-3 w-3" />
              Live
            </Badge>
          ) : (
            <Badge tone="neutral">
              <CircleDashed className="mr-1 inline h-3 w-3" />
              Simulated
            </Badge>
          )}
        </span>
      </button>

      {open && (
        <CardContent className="border-t border-[var(--border)] px-5 py-5">
          <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
            <div>
              <p className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                Credentials
              </p>
              {def.fields.length === 0 && (
                <p className="rounded-[var(--radius-md)] border border-[var(--success-border)] bg-[var(--success-tint)] px-3.5 py-3 text-[12.5px] text-[var(--foreground)]">
                  No credentials required. This read-only integration is available by default.
                </p>
              )}
              <div className="flex flex-col gap-3.5">
                {def.fields.map((f) => {
                  const fieldStatus = status?.fields.find((x) => x.key === f.key);
                  return (
                    <div key={f.key}>
                      <Label htmlFor={`int-${f.key}`}>
                        {f.label}
                        {f.optional && <span className="ml-1.5 text-[var(--muted-foreground)]">(optional)</span>}
                      </Label>
                      {f.multiline ? (
                        <Textarea
                          id={`int-${f.key}`}
                          rows={6}
                          className="font-mono text-xs"
                          value={values[f.key] ?? ""}
                          onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                          placeholder={f.placeholder}
                          disabled={!canEdit || fieldStatus?.fromEnv}
                          autoComplete="off"
                          spellCheck={false}
                        />
                      ) : (
                        <Input
                          id={`int-${f.key}`}
                          type={isSecretKey(f.key) ? "password" : "text"}
                          value={values[f.key] ?? ""}
                          onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                          placeholder={f.placeholder}
                          disabled={!canEdit || fieldStatus?.fromEnv}
                          autoComplete="off"
                          spellCheck={false}
                        />
                      )}
                      <p className="mt-1 text-[11.5px] text-[var(--muted-foreground)]">
                        {fieldStatus?.fromEnv ? (
                          <span className="flex items-center gap-1">
                            <Lock className="h-3 w-3" /> Set by an environment variable — edit it there, or remove it to
                            manage the key here.
                          </span>
                        ) : (
                          f.help
                        )}
                      </p>
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                {def.fields.length > 0 && (
                  <Button onClick={save} loading={isSaving} disabled={!canEdit}>
                    Save
                  </Button>
                )}
                {!isPlatform && (
                  <Button variant="secondary" onClick={runTest} disabled={testing}>
                    {testing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Plug className="mr-1.5 h-3.5 w-3.5" />}
                    Test connection
                  </Button>
                )}
                {def.docsUrl && (
                  <a
                    href={def.docsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="focus-ring inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-1 text-[12.5px] font-medium text-[var(--primary)] hover:underline"
                  >
                    Open dashboard <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>

              {status?.lastVerified && (
                <p className={`mt-2 text-xs ${status.lastVerified.ok ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>
                  Last verified {formatDateTime(status.lastVerified.verifiedAt)} by {status.lastVerified.verifiedByName}: {status.lastVerified.message}
                </p>
              )}

              {!canEdit && def.fields.length > 0 && (
                <p className="mt-2.5 text-[11.5px] text-[var(--muted-foreground)]">
                  Read-only — Admin role and CREDENTIAL_SECRET are both required to change keys.
                </p>
              )}
            </div>

            <div className="rounded-[var(--radius-md)] bg-[var(--background)] p-4">
              {endpoints && endpoints.length > 0 && (
                <div className="mb-4 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3.5">
                  <p className="text-[12px] font-semibold text-[var(--foreground)]">Current production URLs</p>
                  <p className="mt-1 text-[11.5px] leading-relaxed text-[var(--muted-foreground)]">
                    Generated from the effective public origin. Copy these exact HTTPS values into the provider dashboard.
                  </p>
                  {endpointWarning && (
                    <p className="mt-2 rounded-[var(--radius-sm)] border border-[var(--warning-border)] bg-[var(--warning-tint)] px-2.5 py-2 text-[11.5px] text-[var(--foreground)]">
                      {endpointWarning}
                    </p>
                  )}
                  <div className="mt-3 space-y-2.5">
                    {endpoints.map((endpoint) => (
                      <div key={endpoint.label}>
                        <p className="text-[11px] font-medium text-[var(--muted-foreground)]">{endpoint.label}</p>
                        <div className="mt-1 flex items-center gap-2">
                          <code className="min-w-0 flex-1 break-all rounded-[var(--radius-sm)] bg-[var(--background)] px-2.5 py-2 text-[11.5px] text-[var(--foreground)]">
                            {endpoint.url}
                          </code>
                          <Button variant="ghost" size="sm" onClick={() => copyEndpoint(endpoint.url)} aria-label={`Copy ${endpoint.label}`}>
                            {copiedUrl === endpoint.url ? <Check className="h-3.5 w-3.5 text-[var(--success)]" /> : <Copy className="h-3.5 w-3.5" />}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <p className="mb-2.5 text-[12px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                How to set this up
              </p>
              <ol className="flex list-none flex-col gap-2.5">
                {def.setupSteps.map((step, i) => (
                  <li key={i} className="flex gap-2.5 text-[12.5px] leading-relaxed text-[var(--foreground)]">
                    <span className="flex h-4.5 w-4.5 mt-0.5 h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-[var(--primary-tint)] text-[10px] font-bold text-[var(--primary)]">
                      {i + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
              {def.alternativeNote && (
                <p className="mt-3 border-t border-[var(--border)] pt-3 text-[11.5px] leading-relaxed text-[var(--muted-foreground)]">
                  {def.alternativeNote}
                </p>
              )}
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
