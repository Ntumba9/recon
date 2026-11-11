"""Mirrors src/core/reconciler/rules/webhookProviderDisagreement.ts.

A webhook claimed a payment status that the provider's own record for that
payment no longer agrees with. Webhook logs are never trusted as truth on
their own - this rule is exactly the check that keeps that principle
enforced, here as in the TypeScript engine."""

from typing import Dict, List

from ..finding_key import build_finding_key
from ..models import Finding, Payment, ReconcileContext, WebhookEvent
from ..timeutil import parse_iso_to_ms


def webhook_provider_disagreement(ctx: ReconcileContext) -> List[Finding]:
    findings: List[Finding] = []
    payments_by_id: Dict[str, Payment] = {p.id: p for p in ctx.payments}

    latest_claim_by_payment: Dict[str, WebhookEvent] = {}
    for event in ctx.webhook_events:
        if not event.signature_valid:
            continue
        existing = latest_claim_by_payment.get(event.provider_payment_id)
        if existing is None or parse_iso_to_ms(event.received_at) > parse_iso_to_ms(existing.received_at):
            latest_claim_by_payment[event.provider_payment_id] = event

    for payment_id, event in latest_claim_by_payment.items():
        payment = payments_by_id.get(payment_id)
        if payment is None:
            continue
        if event.claimed_status == payment.status:
            continue

        findings.append(
            Finding(
                finding_key=build_finding_key("WEBHOOK_PROVIDER_DISAGREEMENT", payment.order_reference, payment_id),
                mismatch_class="WEBHOOK_PROVIDER_DISAGREEMENT",
                severity="CRITICAL",
                order_reference=payment.order_reference,
                provider_payment_id=payment_id,
                currency=payment.currency,
                amount_minor=payment.amount_minor,
                evidence={
                    "webhookEventId": event.event_id,
                    "webhookClaimedStatus": event.claimed_status,
                    "providerCurrentStatus": payment.status,
                    "webhookReceivedAt": event.received_at,
                },
            )
        )

    return findings
