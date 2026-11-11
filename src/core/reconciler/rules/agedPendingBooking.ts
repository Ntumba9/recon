import { buildFindingKey } from "../findingKey";
import type { Finding, ReconcileContext } from "../types";

/**
 * A PENDING/PAYMENT_PENDING booking that has aged well past the grace period
 * with no provider payment at all - flagged for investigation, never
 * auto-cancelled. Relies on absence, so it never fires against an
 * incomplete provider export.
 */
export function agedPendingBooking(ctx: ReconcileContext): Finding[] {
  if (!ctx.complete) return [];

  const findings: Finding[] = [];
  const hasAnyPaymentByOrder = new Set(ctx.payments.map((p) => p.orderReference));

  for (const order of ctx.orders) {
    if (order.bookingStatus !== "PENDING" && order.bookingStatus !== "PAYMENT_PENDING") continue;
    if (hasAnyPaymentByOrder.has(order.reference)) continue;

    const ageMs = ctx.now.getTime() - order.createdAt.getTime();
    if (ageMs < ctx.gracePeriodMs) continue;

    findings.push({
      findingKey: buildFindingKey("AGED_PENDING_BOOKING", order.reference),
      mismatchClass: "AGED_PENDING_BOOKING",
      severity: "WARNING",
      orderReference: order.reference,
      providerPaymentId: null,
      currency: order.currency,
      amountMinor: order.amountMinor,
      evidence: {
        orderBookingStatus: order.bookingStatus,
        orderCreatedAt: order.createdAt.toISOString(),
        ageMs,
      },
    });
  }

  return findings;
}
