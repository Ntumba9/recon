"""Mirrors src/core/reconciler/rules/duplicateSuccessfulPayment.ts."""

from collections import defaultdict
from typing import Dict, List

from ..finding_key import build_finding_key
from ..models import Finding, Payment, ReconcileContext


def duplicate_successful_payment(ctx: ReconcileContext) -> List[Finding]:
    findings: List[Finding] = []
    by_order: Dict[str, List[Payment]] = defaultdict(list)

    for payment in ctx.payments:
        if payment.status != "successful":
            continue
        by_order[payment.order_reference].append(payment)

    for order_reference, payments in by_order.items():
        if len(payments) < 2:
            continue
        sorted_ids = sorted(p.id for p in payments)

        findings.append(
            Finding(
                finding_key=build_finding_key("DUPLICATE_SUCCESSFUL_PAYMENT", order_reference, ",".join(sorted_ids)),
                mismatch_class="DUPLICATE_SUCCESSFUL_PAYMENT",
                severity="CRITICAL",
                order_reference=order_reference,
                provider_payment_id=sorted_ids[0] if sorted_ids else None,
                currency=payments[0].currency if payments else None,
                amount_minor=sum(p.amount_minor for p in payments),
                evidence={
                    "paymentIds": sorted_ids,
                    "count": len(payments),
                    "perPaymentAmountsMinor": [p.amount_minor for p in payments],
                },
            )
        )

    return findings
