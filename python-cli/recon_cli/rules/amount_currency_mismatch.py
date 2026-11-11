"""Mirrors src/core/reconciler/rules/amountCurrencyMismatch.ts."""

from typing import Dict, List

from ..finding_key import build_finding_key
from ..models import Finding, Order, ReconcileContext


def amount_currency_mismatch(ctx: ReconcileContext) -> List[Finding]:
    findings: List[Finding] = []
    orders_by_ref: Dict[str, Order] = {o.reference: o for o in ctx.orders}

    for payment in ctx.payments:
        if payment.status != "successful":
            continue
        order = orders_by_ref.get(payment.order_reference)
        if order is None:
            continue

        amount_mismatch = payment.amount_minor != order.amount_minor
        currency_mismatch = payment.currency != order.currency
        if not amount_mismatch and not currency_mismatch:
            continue

        findings.append(
            Finding(
                finding_key=build_finding_key("AMOUNT_CURRENCY_MISMATCH", order.reference, payment.id),
                mismatch_class="AMOUNT_CURRENCY_MISMATCH",
                severity="CRITICAL",
                order_reference=order.reference,
                provider_payment_id=payment.id,
                currency=payment.currency,
                amount_minor=payment.amount_minor,
                evidence={
                    "orderAmountMinor": order.amount_minor,
                    "orderCurrency": order.currency,
                    "paymentAmountMinor": payment.amount_minor,
                    "paymentCurrency": payment.currency,
                    "amountMismatch": amount_mismatch,
                    "currencyMismatch": currency_mismatch,
                },
            )
        )

    return findings
