import { successfulPaymentNotConfirmed } from "./rules/successfulPaymentNotConfirmed";
import { confirmedWithoutSuccessfulPayment } from "./rules/confirmedWithoutSuccessfulPayment";
import { duplicateSuccessfulPayment } from "./rules/duplicateSuccessfulPayment";
import { amountCurrencyMismatch } from "./rules/amountCurrencyMismatch";
import { agedPendingBooking } from "./rules/agedPendingBooking";
import { webhookProviderDisagreement } from "./rules/webhookProviderDisagreement";
import type { Finding, ReconcileContext, ReconcileResult } from "./types";

const RULES: Array<(ctx: ReconcileContext) => Finding[]> = [
  successfulPaymentNotConfirmed,
  confirmedWithoutSuccessfulPayment,
  duplicateSuccessfulPayment,
  amountCurrencyMismatch,
  agedPendingBooking,
  webhookProviderDisagreement,
];

/**
 * Pure comparison: given orders, the full set of provider payments already
 * fetched for the window, and the app's webhook log, produce findings.
 * Takes no action beyond reporting - no refunds, retries, or booking
 * corrections happen here or anywhere in RECON.
 */
export function reconcile(ctx: ReconcileContext): ReconcileResult {
  const findings = RULES.flatMap((rule) => rule(ctx));
  // Stable, readable ordering: by mismatch class, then by order reference.
  findings.sort((a, b) => {
    if (a.mismatchClass !== b.mismatchClass) return a.mismatchClass.localeCompare(b.mismatchClass);
    return (a.orderReference ?? "").localeCompare(b.orderReference ?? "");
  });
  return { status: "SUCCESS", findings };
}

export * from "./types";
export { buildFindingKey } from "./findingKey";
