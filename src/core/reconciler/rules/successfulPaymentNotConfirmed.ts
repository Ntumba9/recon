import { buildFindingKey } from "../findingKey";
import type { Finding, ReconcileContext } from "../types";

/** A payment the provider marks successful, whose order is not CONFIRMED. Pending is never treated as successful - only "successful" payments count here. */
export function successfulPaymentNotConfirmed(ctx: ReconcileContext): Finding[] {
  const findings: Finding[] = [];
  const ordersByRef = new Map(ctx.orders.map((o) => [o.reference, o]));

  for (const payment of ctx.payments) {
    if (payment.status !== "successful") continue;

    const ageMs = ctx.now.getTime() - new Date(payment.updatedAt).getTime();
    if (ageMs < ctx.gracePeriodMs) continue;

    const order = ordersByRef.get(payment.orderReference);
    if (!order) continue;
    if (order.bookingStatus === "CONFIRMED") continue;

    findings.push({
      findingKey: buildFindingKey("SUCCESSFUL_PAYMENT_NOT_CONFIRMED", order.reference, payment.id),
      mismatchClass: "SUCCESSFUL_PAYMENT_NOT_CONFIRMED",
      severity: "CRITICAL",
      orderReference: order.reference,
      providerPaymentId: payment.id,
      currency: payment.currency,
      amountMinor: payment.amountMinor,
      evidence: {
        orderBookingStatus: order.bookingStatus,
        paymentStatus: payment.status,
        paymentUpdatedAt: payment.updatedAt,
      },
    });
  }

  return findings;
}
