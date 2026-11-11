import { buildFindingKey } from "../findingKey";
import type { Finding, ReconcileContext } from "../types";

/**
 * A CONFIRMED booking with no successful payment at the provider at all.
 * Relies on absence, so it never fires against an incomplete provider
 * export, and a grace period (measured from when the order was last
 * updated) keeps a booking that was only just confirmed - where the
 * provider or webhook may simply not have caught up yet - from being
 * flagged the instant it's checked.
 */
export function confirmedWithoutSuccessfulPayment(ctx: ReconcileContext): Finding[] {
  if (!ctx.complete) return [];

  const findings: Finding[] = [];
  const successfulByOrder = new Set(
    ctx.payments.filter((p) => p.status === "successful").map((p) => p.orderReference)
  );

  for (const order of ctx.orders) {
    if (order.bookingStatus !== "CONFIRMED") continue;
    if (successfulByOrder.has(order.reference)) continue;

    const ageSinceUpdateMs = ctx.now.getTime() - order.updatedAt.getTime();
    if (ageSinceUpdateMs < ctx.gracePeriodMs) continue;

    findings.push({
      findingKey: buildFindingKey("CONFIRMED_WITHOUT_SUCCESSFUL_PAYMENT", order.reference),
      mismatchClass: "CONFIRMED_WITHOUT_SUCCESSFUL_PAYMENT",
      severity: "CRITICAL",
      orderReference: order.reference,
      providerPaymentId: null,
      currency: order.currency,
      amountMinor: order.amountMinor,
      evidence: {
        orderBookingStatus: order.bookingStatus,
        matchingPaymentsFound: 0,
        orderUpdatedAt: order.updatedAt.toISOString(),
        ageSinceUpdateMs,
      },
    });
  }

  return findings;
}
