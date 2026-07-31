// Input validation for the one public, unauthenticated write path in the
// app (submitIntakeAction). Everything else requires a session; this is the
// actual trust boundary — it's the only place a stranger on the internet can
// get bytes into the database, so it's the one place that needs real limits,
// not just a truthiness check.

import { z } from "zod";
import { STATE_NAMES } from "@/domain/stateTimezone";

const NAME_MAX = 100;
const TEXT_MAX = 200;

export const intakeInputSchema = z.object({
  intent: z.enum(["REFINANCE", "HOME_EQUITY", "CASH_OUT", "UNKNOWN"]),
  firstName: z.string().trim().min(1, "Required").max(NAME_MAX),
  lastName: z.string().trim().min(1, "Required").max(NAME_MAX),
  phone: z.string().trim().min(1, "Required").max(30),
  email: z.string().trim().min(1, "Required").max(TEXT_MAX).email("Enter a valid email"),
  stateCode: z.enum(Object.keys(STATE_NAMES) as [string, ...string[]], { message: "Select a state" }),
  city: z.string().trim().max(TEXT_MAX).optional(),
  addressLine1: z.string().trim().max(TEXT_MAX).optional(),
  occupancy: z.enum(["PRIMARY", "SECOND_HOME", "INVESTMENT", "UNKNOWN"]),
  estimatedValue: z.number().finite().nonnegative().max(100_000_000).optional(),
  currentBalance: z.number().finite().nonnegative().max(100_000_000).optional(),
  goal: z.enum(["LOWER_PAYMENT", "CASH_OUT", "SHORTEN_TERM", "DEBT_CONSOLIDATION", "OTHER"]),
  timeline: z.enum(["ASAP", "1_3_MONTHS", "3_6_MONTHS", "EXPLORING"]),
  bestContactTime: z.enum(["MORNING", "AFTERNOON", "EVENING", "ANY"]),
  creditRange: z.enum(["EXCELLENT_740_PLUS", "GOOD_680_739", "FAIR_620_679", "BELOW_620", "UNSURE"]),
  missedPayments: z.enum(["NONE", "ONE_TO_TWO", "THREE_PLUS"]),
  hasExistingHomeEquityLoan: z.boolean().optional(),
  intakeDurationSeconds: z.number().finite().nonnegative().max(86_400).optional(),
  consents: z.object({
    voice: z.boolean(),
    sms: z.boolean(),
    email: z.boolean(),
    recording: z.boolean(),
  }),
});
