import { buildFindingKey } from "../findingKey";
import type { Finding, ReconcileContext } from "../types";

/**
 * A webhook claimed a payment status that the provider's own record for
 * that payment, fetched directly, no longer agrees with. Webhook logs are
 * never trusted as truth on their own - this rule is exactly the check
 * that keeps that principle enforced.
 */
export function webhookProviderDisagreement(ctx: ReconcileContext): Finding[] {
  const findings: Finding[] = [];
  const paymentsById = new Map(ctx.payments.map((p) => [p.id, p]));

  const latestClaimByPayment = new Map<string, (typeof ctx.webhookEvents)[number]>();
  for (const event of ctx.webhookEvents) {
    if (!event.signatureValid) continue;
    const existing = latestClaimByPayment.get(event.providerPaymentId);
    if (!existing || event.receivedAt > existing.receivedAt) {
      latestClaimByPayment.set(event.providerPaymentId, event);
    }
  }

  for (const [paymentId, event] of latestClaimByPayment) {
    const payment = paymentsById.get(paymentId);
    if (!payment) continue;
    if (event.claimedStatus === payment.status) continue;

    findings.push({
      findingKey: buildFindingKey("WEBHOOK_PROVIDER_DISAGREEMENT", payment.orderReference, paymentId),
      mismatchClass: "WEBHOOK_PROVIDER_DISAGREEMENT",
      severity: "CRITICAL",
      orderReference: payment.orderReference,
      providerPaymentId: paymentId,
      currency: payment.currency,
      amountMinor: payment.amountMinor,
      evidence: {
        webhookEventId: event.eventId,
        webhookClaimedStatus: event.claimedStatus,
        providerCurrentStatus: payment.status,
        webhookReceivedAt: event.receivedAt.toISOString(),
      },
    });
  }

  return findings;
}
