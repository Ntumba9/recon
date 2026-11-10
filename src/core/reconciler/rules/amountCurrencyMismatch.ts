import { buildFindingKey } from "../findingKey";
import type { Finding, ReconcileContext } from "../types";

/** A successful payment whose amount or currency does not match its order. */
export function amountCurrencyMismatch(ctx: ReconcileContext): Finding[] {
  const findings: Finding[] = [];
  const ordersByRef = new Map(ctx.orders.map((o) => [o.reference, o]));

  for (const payment of ctx.payments) {
    if (payment.status !== "successful") continue;
    const order = ordersByRef.get(payment.orderReference);
    if (!order) continue;

    const amountMismatch = payment.amountMinor !== order.amountMinor;
    const currencyMismatch = payment.currency !== order.currency;
    if (!amountMismatch && !currencyMismatch) continue;

    findings.push({
      findingKey: buildFindingKey("AMOUNT_CURRENCY_MISMATCH", order.reference, payment.id),
      mismatchClass: "AMOUNT_CURRENCY_MISMATCH",
      severity: "CRITICAL",
      orderReference: order.reference,
      providerPaymentId: payment.id,
      currency: payment.currency,
      amountMinor: payment.amountMinor,
      evidence: {
        orderAmountMinor: order.amountMinor,
        orderCurrency: order.currency,
        paymentAmountMinor: payment.amountMinor,
        paymentCurrency: payment.currency,
        amountMismatch,
        currencyMismatch,
      },
    });
  }

  return findings;
}
