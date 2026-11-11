"""Mirrors src/core/reconciler/rules/successfulPaymentNotConfirmed.ts."""

from typing import Dict, List

from ..finding_key import build_finding_key
from ..models import Finding, Order, ReconcileContext
from ..timeutil import parse_iso_to_ms


def successful_payment_not_confirmed(ctx: ReconcileContext) -> List[Finding]:
    findings: List[Finding] = []
    orders_by_ref: Dict[str, Order] = {o.reference: o for o in ctx.orders}
    now_ms = parse_iso_to_ms(ctx.now)

    for payment in ctx.payments:
        if payment.status != "successful":
            continue

        age_ms = now_ms - parse_iso_to_ms(payment.updated_at)
        if age_ms < ctx.grace_period_ms:
            continue

        order = orders_by_ref.get(payment.order_reference)
        if order is None:
            continue
        if order.booking_status == "CONFIRMED":
            continue

        findings.append(
            Finding(
                finding_key=build_finding_key("SUCCESSFUL_PAYMENT_NOT_CONFIRMED", order.reference, payment.id),
                mismatch_class="SUCCESSFUL_PAYMENT_NOT_CONFIRMED",
                severity="CRITICAL",
                order_reference=order.reference,
                provider_payment_id=payment.id,
                currency=payment.currency,
                amount_minor=payment.amount_minor,
                evidence={
                    "orderBookingStatus": order.booking_status,
                    "paymentStatus": payment.status,
                    "paymentUpdatedAt": payment.updated_at,
                },
            )
        )

    return findings
