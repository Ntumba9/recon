"""Mirrors src/core/reconciler/rules/agedPendingBooking.ts.

A PENDING/PAYMENT_PENDING booking that has aged well past the grace period
with no provider payment at all - flagged for investigation, never
auto-cancelled. Relies on absence, so it never fires against an incomplete
provider export."""

from typing import List, Set

from ..finding_key import build_finding_key
from ..models import Finding, ReconcileContext
from ..timeutil import parse_iso_to_ms


def aged_pending_booking(ctx: ReconcileContext) -> List[Finding]:
    if not ctx.complete:
        return []

    findings: List[Finding] = []
    has_any_payment_by_order: Set[str] = {p.order_reference for p in ctx.payments}
    now_ms = parse_iso_to_ms(ctx.now)

    for order in ctx.orders:
        if order.booking_status not in ("PENDING", "PAYMENT_PENDING"):
            continue
        if order.reference in has_any_payment_by_order:
            continue

        age_ms = now_ms - parse_iso_to_ms(order.created_at)
        if age_ms < ctx.grace_period_ms:
            continue

        findings.append(
            Finding(
                finding_key=build_finding_key("AGED_PENDING_BOOKING", order.reference),
                mismatch_class="AGED_PENDING_BOOKING",
                severity="WARNING",
                order_reference=order.reference,
                provider_payment_id=None,
                currency=order.currency,
                amount_minor=order.amount_minor,
                evidence={
                    "orderBookingStatus": order.booking_status,
                    "orderCreatedAt": order.created_at,
                    "ageMs": age_ms,
                },
            )
        )

    return findings
