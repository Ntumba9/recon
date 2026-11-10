import { buildFindingKey } from "../findingKey";
import type { Finding, ReconcileContext } from "../types";

/** A CONFIRMED booking with no successful payment at the provider at all. */
export function confirmedWithoutSuccessfulPayment(ctx: ReconcileContext): Finding[] {
  const findings: Finding[] = [];
  const successfulByOrder = new Set(
    ctx.payments.filter((p) => p.status === "successful").map((p) => p.orderReference)
  );

  for (const order of ctx.orders) {
    if (order.bookingStatus !== "CONFIRMED") continue;
    if (successfulByOrder.has(order.reference)) continue;

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
      },
    });
  }

  return findings;
}
