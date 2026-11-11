"""Mirrors src/core/reconciler/rules/confirmedWithoutSuccessfulPayment.ts.

A CONFIRMED booking with no successful payment at the provider at all.
Relies on absence, so it never fires against an incomplete provider export,
and a grace period (measured from when the order was last updated) keeps a
booking that was only just confirmed from being flagged the instant it's
checked."""

from typing import List, Set

from ..finding_key import build_finding_key
from ..models import Finding, ReconcileContext
from ..timeutil import parse_iso_to_ms


def confirmed_without_successful_payment(ctx: ReconcileContext) -> List[Finding]:
    if not ctx.complete:
        return []

    findings: List[Finding] = []
    successful_by_order: Set[str] = {p.order_reference for p in ctx.payments if p.status == "successful"}
    now_ms = parse_iso_to_ms(ctx.now)

    for order in ctx.orders:
        if order.booking_status != "CONFIRMED":
            continue
        if order.reference in successful_by_order:
            continue

        age_since_update_ms = now_ms - parse_iso_to_ms(order.updated_at)
        if age_since_update_ms < ctx.grace_period_ms:
            continue

        findings.append(
            Finding(
                finding_key=build_finding_key("CONFIRMED_WITHOUT_SUCCESSFUL_PAYMENT", order.reference),
                mismatch_class="CONFIRMED_WITHOUT_SUCCESSFUL_PAYMENT",
                severity="CRITICAL",
                order_reference=order.reference,
                provider_payment_id=None,
                currency=order.currency,
                amount_minor=order.amount_minor,
                evidence={
                    "orderBookingStatus": order.booking_status,
                    "matchingPaymentsFound": 0,
                    "orderUpdatedAt": order.updated_at,
                    "ageSinceUpdateMs": age_since_update_ms,
                },
            )
        )

    return findings
