export const GENERIC_ANALYTICS_EVENTS = [
  "intake_started",
  "intake_step_completed",
  "intake_submitted",
  "calculator_used",
  "borrower_channel_selected",
  "ab_test_exposure",
] as const;

export type AnalyticsEvent = (typeof GENERIC_ANALYTICS_EVENTS)[number];

/** Keep analytics payloads incapable of carrying borrower or loan data. */
export function sanitizeAnalyticsParams(
  event: AnalyticsEvent,
  params?: Record<string, string | number | boolean>,
): Record<string, string | number | boolean> {
  if (event === "intake_step_completed" && typeof params?.step === "number" && Number.isInteger(params.step)) {
    return { step: Math.max(0, Math.min(20, params.step)) };
  }
  return {};
}
