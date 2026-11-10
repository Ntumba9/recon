import { buildFindingKey } from "../findingKey";
import type { Finding, ReconcileContext } from "../types";

/** More than one successful payment recorded against the same order. */
export function duplicateSuccessfulPayment(ctx: ReconcileContext): Finding[] {
  const findings: Finding[] = [];
  const byOrder = new Map<string, typeof ctx.payments>();

  for (const payment of ctx.payments) {
    if (payment.status !== "successful") continue;
    const list = byOrder.get(payment.orderReference) ?? [];
    list.push(payment);
    byOrder.set(payment.orderReference, list);
  }

  for (const [orderReference, payments] of byOrder) {
    if (payments.length < 2) continue;
    const sortedIds = payments.map((p) => p.id).sort();

    findings.push({
      findingKey: buildFindingKey("DUPLICATE_SUCCESSFUL_PAYMENT", orderReference, sortedIds.join(",")),
      mismatchClass: "DUPLICATE_SUCCESSFUL_PAYMENT",
      severity: "CRITICAL",
      orderReference,
      providerPaymentId: sortedIds[0] ?? null,
      currency: payments[0]?.currency ?? null,
      amountMinor: payments.reduce((sum, p) => sum + p.amountMinor, 0),
      evidence: {
        paymentIds: sortedIds,
        count: payments.length,
        perPaymentAmountsMinor: payments.map((p) => p.amountMinor),
      },
    });
  }

  return findings;
}
