// The shared result contract for every outbound provider adapter.
//
// This is a discriminated union rather than a bag of optional fields, and
// that is the whole point. The previous shape was:
//
//   { providerMessageId: string; simulated: boolean; error?: string }
//
// which made ignoring a failure the path of least resistance — read
// `providerMessageId`, write it to the attempt row, report success. Three
// call sites did exactly that, and the CRM told officers a call had connected
// when Twilio had rejected it. Nothing in the type system objected, because
// nothing required `error` to be read.
//
// With a union, `result.providerMessageId` does not typecheck until the
// caller has narrowed on `result.ok`. The compiler now asks the question the
// reviewer had to ask by hand.

import type { DeliveryFailure } from "@/core/deliveryStatus";

export interface AdapterSuccess {
  ok: true;
  providerMessageId: string;
  /** True when no provider was configured and nothing actually went out. */
  simulated: boolean;
}

export interface AdapterFailure {
  ok: false;
  failure: DeliveryFailure;
  /** Present when the provider assigned an id before failing; usually absent. */
  providerMessageId?: string;
}

export type AdapterResult = AdapterSuccess | AdapterFailure;

export function adapterSuccess(providerMessageId: string, simulated = false): AdapterSuccess {
  return { ok: true, providerMessageId, simulated };
}

export function adapterFailure(failure: DeliveryFailure): AdapterFailure {
  return { ok: false, failure };
}
