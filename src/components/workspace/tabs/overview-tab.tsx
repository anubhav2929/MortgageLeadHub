import { Phone, Mail, Clock, MapPin, DollarSign, Target, CreditCard, ShieldAlert, Scale, Flame } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ReferralBanner } from "@/components/workspace/referral-banner";
import { PropertyValuationCard } from "@/components/workspace/property-valuation-card";
import { AssignOfficerPicker } from "@/components/workspace/assign-officer-picker";
import { propertyClarifications } from "@/core/propertyValuationQuality";
import type { LeadScoreResult } from "@/core/leadScoring";
import { maskEmail, maskPhone } from "@/core/rbac";
import { formatDateTime, titleCase } from "@/lib/utils";
import type { CadencePlan, CreditPullResult, Lead, Officer, Person, PropertyValuationResult, ReferralPartner } from "@/domain/types";

const SCORE_COMPONENT_LABEL: Record<keyof LeadScoreResult["breakdown"], string> = {
  equity: "Usable equity",
  margin: "Product margin",
  compliance: "State licensing",
  behavior: "Urgency & speed",
};

function Field({
  icon: Icon,
  label,
  value,
  href,
}: {
  icon: React.ElementType;
  label: string;
  value: React.ReactNode;
  href?: string;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
      <div>
        <p className="text-xs text-[var(--muted-foreground)]">{label}</p>
        {href ? (
          <a href={href} className="text-[13px] font-medium text-[var(--primary)] hover:underline">
            {value}
          </a>
        ) : (
          <p className="text-[13px] font-medium text-[var(--foreground)]">{value}</p>
        )}
      </div>
    </div>
  );
}

export function OverviewTab({
  lead,
  person,
  officer,
  cadencePlan,
  canViewPii,
  missing,
  referralPartners,
  canRefer,
  qualityScore,
  propertyValuation,
  creditPull,
  completenessScore,
  attemptsToday,
  officers,
  canAssignOfficer,
  canRerunPropertyValuation,
}: {
  lead: Lead;
  person?: Person;
  officer?: Officer;
  cadencePlan?: CadencePlan;
  canViewPii: boolean;
  missing: string[];
  referralPartners: ReferralPartner[];
  canRefer: boolean;
  qualityScore: LeadScoreResult;
  officers?: Officer[];
  canAssignOfficer?: boolean;
  canRerunPropertyValuation?: boolean;
  propertyValuation: PropertyValuationResult;
  creditPull?: CreditPullResult;
  completenessScore: number;
  attemptsToday: number;
}) {
  const texasEquityFlag =
    lead.stateCode === "TX" && (lead.intent === "CASH_OUT" || lead.intent === "HOME_EQUITY") && lead.hasExistingHomeEquityLoan === true;

  return (
    <div className="space-y-4">
      {texasEquityFlag && (
        <Card className="border-[var(--danger-border)] bg-[var(--danger-tint)]">
          <CardContent className="flex items-start gap-2.5 p-4">
            <Scale className="mt-0.5 h-4 w-4 shrink-0 text-[var(--danger)]" />
            <div>
              <p className="text-[13px] font-semibold text-[var(--foreground)]">Texas Section 50(a)(6) — verify eligibility</p>
              <p className="mt-0.5 text-xs leading-relaxed text-[var(--muted-foreground)]">
                Borrower reported an existing home equity loan on this property. Texas law permits only one outstanding
                home-equity loan at a time — confirm eligibility before proceeding with a cash-out refinance or new
                home equity product.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <ReferralBanner
        publicRef={lead.publicRef}
        referralType={lead.referralType}
        referredToPartnerId={lead.referredToPartnerId}
        referredAt={lead.referredAt}
        partners={referralPartners}
        canRefer={canRefer}
      />

      {person?.dataQualityFlags && person.dataQualityFlags.length > 0 && (
        <Card className="border-[var(--warning-border)] bg-[var(--warning-tint)]">
          <CardContent className="flex items-start gap-2.5 p-4">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-[var(--warning)]" />
            <div>
              <p className="text-[13px] font-semibold text-[var(--foreground)]">Data quality flag on contact info</p>
              <p className="mt-0.5 text-xs leading-relaxed text-[var(--muted-foreground)]">
                {person.dataQualityFlags.join("; ")} — verify this is a real contact before spending an attempt on it.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Contact & loan details</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-5">
            <Field
              icon={Phone}
              label="Phone"
              value={person ? (canViewPii ? person.phoneE164 : maskPhone(person.phoneE164)) : "—"}
              href={person && canViewPii ? `tel:${person.phoneE164}` : undefined}
            />
            <Field
              icon={Mail}
              label="Email"
              value={person ? (canViewPii ? person.email : maskEmail(person.email)) : "—"}
              href={person && canViewPii ? `mailto:${person.email}` : undefined}
            />
            <Field icon={MapPin} label="Property" value={`${lead.city ?? "—"}, ${lead.stateCode}`} />
            <Field icon={Clock} label="Timezone" value={person?.timezone ?? "UNKNOWN"} />
            <Field icon={Target} label="Goal" value={titleCase(lead.goal)} />
            <Field icon={Clock} label="Timeline" value={titleCase(lead.timeline)} />
            <Field
              icon={CreditCard}
              label="Credit range"
              value={
                creditPull && !creditPull.failureMessage ? (
                  <span className="flex flex-wrap items-center gap-1.5">
                    {titleCase(creditPull.band)}
                    <span
                      title={
                        creditPull.simulated
                          ? "Simulated — no iSoftpull credentials configured."
                          : `Verified by soft credit inquiry${creditPull.bureau ? ` (${creditPull.bureau})` : ""}.`
                      }
                      className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${
                        creditPull.simulated
                          ? "bg-[var(--warning-tint)] text-[var(--warning)]"
                          : "bg-[var(--success-tint)] text-[var(--success)]"
                      }`}
                    >
                      {creditPull.simulated ? "simulated" : "verified"}
                    </span>
                  </span>
                ) : (
                  // No pull on file. Saying "Unsure" would imply the borrower
                  // told us that — they were never asked.
                  <span className="text-[var(--muted-foreground)]">Not checked</span>
                )
              }
            />
            <Field
              icon={DollarSign}
              label="Borrower-reported value"
              value={lead.estimatedValue ? `$${lead.estimatedValue.toLocaleString()}` : "Not collected"}
            />
            <Field
              icon={DollarSign}
              label="Current mortgage balance"
              value={lead.currentBalance !== undefined ? `$${lead.currentBalance.toLocaleString()}` : "Not collected"}
            />
          </CardContent>
        </Card>

        <div className="space-y-4">
          <PropertyValuationCard
            valuation={propertyValuation}
            publicRef={lead.publicRef}
            canRerun={Boolean(canRerunPropertyValuation)}
            clarifications={propertyClarifications(lead, propertyValuation)}
          />
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Lead quality score</CardTitle>
              {qualityScore.tier === "HOT" && (
                <span className="flex items-center gap-1 text-xs font-semibold text-[var(--danger)]">
                  <Flame className="h-3.5 w-3.5" /> HOT
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="mb-2 flex items-baseline gap-2">
              <span className="text-2xl font-semibold text-[var(--foreground)]">{qualityScore.total}</span>
              <span className="text-xs text-[var(--muted-foreground)]">/ 100</span>
              {qualityScore.ltv !== null && <span className="ml-auto text-xs text-[var(--muted-foreground)]">LTV {qualityScore.ltv.toFixed(0)}%</span>}
            </div>
            <Progress value={qualityScore.total} tone={qualityScore.tier === "HOT" ? "danger" : "primary"} />
            <div className="mt-3 space-y-1.5">
              {(Object.keys(qualityScore.breakdown) as (keyof LeadScoreResult["breakdown"])[]).map((key) => (
                <div key={key} className="flex items-center justify-between text-xs">
                  <span className="text-[var(--muted-foreground)]">{SCORE_COMPONENT_LABEL[key]}</span>
                  <span className="font-medium text-[var(--foreground)]">{qualityScore.breakdown[key]} pts</span>
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-[var(--muted-foreground)]">
              Predicted deal quality/revenue — distinct from completeness below, which just tracks data collected.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Completeness</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-2 flex items-baseline gap-2">
              <span className="text-2xl font-semibold text-[var(--foreground)]">{completenessScore}</span>
              <span className="text-xs text-[var(--muted-foreground)]">/ 100</span>
            </div>
            <Progress value={completenessScore} tone={completenessScore >= 70 ? "success" : completenessScore >= 40 ? "warning" : "danger"} />
            {missing.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {missing.map((f) => (
                  <Badge key={f} tone="warning">
                    {f}
                  </Badge>
                ))}
              </div>
            )}
            <p className="mt-2 text-xs text-[var(--muted-foreground)]">
              A weighted signal, not a quality or approval indicator.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Assignment</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {officer ? (
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--primary-tint)] text-[13px] font-semibold text-[var(--primary)]">
                  {officer.name.charAt(0)}
                </span>
                <div>
                  <p className="text-[13px] font-medium text-[var(--foreground)]">{officer.name}</p>
                  <p className="text-xs text-[var(--muted-foreground)]">NMLS {officer.nmlsId}</p>
                </div>
              </div>
            ) : (
              <p className="flex items-center gap-1.5 text-[13px] text-[var(--warning)]">
                <ShieldAlert className="h-3.5 w-3.5" /> No officer assigned
              </p>
            )}
            {cadencePlan && (
              <p className="text-xs text-[var(--muted-foreground)]">
                Cadence plan: <span className="font-medium text-[var(--foreground)]">{cadencePlan.name}</span>
              </p>
            )}
            {canAssignOfficer && officers && officers.length > 0 && (
              <div className="pt-1">
                <AssignOfficerPicker publicRef={lead.publicRef} officers={officers} currentOfficerId={lead.assignedOfficerId} />
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>SLA</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <p className="text-[13px] text-[var(--muted-foreground)]">Due: {formatDateTime(lead.slaDueAt)}</p>
            <p className="text-[13px] text-[var(--muted-foreground)]">
              First contact: {lead.firstContactAt ? formatDateTime(lead.firstContactAt) : "Not yet contacted"}
            </p>
            <p className="text-[13px] text-[var(--muted-foreground)]">
              Attempts: {lead.attemptsTotal} total · {attemptsToday} today
            </p>
          </CardContent>
        </Card>
        </div>
      </div>
    </div>
  );
}
