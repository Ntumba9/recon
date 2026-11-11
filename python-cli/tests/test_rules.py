"""Independent sanity tests for each rule, parallel to tests/unit/reconcile.test.ts.
These exercise the Python engine directly (not through the CLI/CSV layer) -
see test_parity.py for the full CSV-to-findings parity check against the
checked-in golden fixture."""

import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from recon_cli.models import Order, Payment, ReconcileContext, WebhookEvent  # noqa: E402
from recon_cli.reconcile import reconcile  # noqa: E402

NOW = "2026-06-01T12:00:00.000Z"


def order(reference="ord_1", currency="ZAR", amount_minor=10000, booking_status="PENDING",
          created_at="2026-05-01T00:00:00.000Z", updated_at=None):
    return Order(
        reference=reference,
        currency=currency,
        amount_minor=amount_minor,
        booking_status=booking_status,
        created_at=created_at,
        updated_at=updated_at if updated_at is not None else created_at,
    )


def payment(payment_id="pay_1", order_reference="ord_1", amount_minor=10000, currency="ZAR",
            status="successful", created_at="2026-05-01T00:05:00.000Z", updated_at=None):
    return Payment(
        id=payment_id,
        order_reference=order_reference,
        amount_minor=amount_minor,
        currency=currency,
        status=status,
        created_at=created_at,
        updated_at=updated_at if updated_at is not None else created_at,
    )


def ctx(orders=None, payments=None, webhook_events=None, now=NOW, grace_period_ms=0, complete=True):
    return ReconcileContext(
        orders=orders or [],
        payments=payments or [],
        webhook_events=webhook_events or [],
        now=now,
        grace_period_ms=grace_period_ms,
        complete=complete,
    )


class ReconcileTest(unittest.TestCase):
    def test_reports_nothing_for_a_clean_confirmed_successfully_paid_order(self):
        result = reconcile(ctx(orders=[order(booking_status="CONFIRMED")], payments=[payment()]))
        self.assertEqual(result.findings, [])

    def test_flags_a_successful_payment_whose_booking_is_not_confirmed(self):
        result = reconcile(ctx(orders=[order(booking_status="PAYMENT_PENDING")], payments=[payment()]))
        self.assertEqual([f.mismatch_class for f in result.findings], ["SUCCESSFUL_PAYMENT_NOT_CONFIRMED"])

    def test_flags_a_confirmed_booking_with_no_successful_payment(self):
        result = reconcile(ctx(orders=[order(booking_status="CONFIRMED")], payments=[]))
        self.assertEqual([f.mismatch_class for f in result.findings], ["CONFIRMED_WITHOUT_SUCCESSFUL_PAYMENT"])

    def test_flags_duplicate_successful_payments(self):
        result = reconcile(
            ctx(
                orders=[order(booking_status="CONFIRMED")],
                payments=[payment(payment_id="pay_1"), payment(payment_id="pay_2")],
            )
        )
        self.assertEqual([f.mismatch_class for f in result.findings], ["DUPLICATE_SUCCESSFUL_PAYMENT"])
        self.assertEqual(result.findings[0].evidence["count"], 2)

    def test_flags_an_amount_mismatch(self):
        result = reconcile(
            ctx(
                orders=[order(booking_status="CONFIRMED", amount_minor=10000)],
                payments=[payment(amount_minor=9500)],
            )
        )
        self.assertEqual([f.mismatch_class for f in result.findings], ["AMOUNT_CURRENCY_MISMATCH"])

    def test_flags_a_currency_mismatch(self):
        result = reconcile(
            ctx(
                orders=[order(booking_status="CONFIRMED", currency="ZAR")],
                payments=[payment(currency="USD")],
            )
        )
        self.assertEqual([f.mismatch_class for f in result.findings], ["AMOUNT_CURRENCY_MISMATCH"])

    def test_flags_an_aged_pending_booking(self):
        result = reconcile(
            ctx(
                orders=[order(booking_status="PAYMENT_PENDING", created_at="2026-05-01T00:00:00.000Z")],
                payments=[],
                grace_period_ms=60 * 60 * 1000,
            )
        )
        self.assertEqual([f.mismatch_class for f in result.findings], ["AGED_PENDING_BOOKING"])

    def test_does_not_flag_a_pending_booking_inside_the_grace_period(self):
        result = reconcile(
            ctx(
                orders=[order(booking_status="PAYMENT_PENDING", created_at="2026-06-01T11:59:59.000Z")],
                payments=[],
                grace_period_ms=60 * 60 * 1000,
            )
        )
        self.assertEqual(result.findings, [])

    def test_treats_a_refund_as_resolved_not_missing_money(self):
        result = reconcile(ctx(orders=[order(booking_status="CANCELLED")], payments=[payment(status="refunded")]))
        self.assertEqual(result.findings, [])

    def test_never_treats_a_pending_payment_as_successful(self):
        result = reconcile(
            ctx(orders=[order(booking_status="PAYMENT_PENDING")], payments=[payment(status="pending")])
        )
        self.assertEqual(result.findings, [])

    def test_flags_webhook_provider_disagreement(self):
        events = [
            WebhookEvent(
                event_id="evt_1",
                provider_payment_id="pay_1",
                order_reference="ord_1",
                type="payment.succeeded",
                signature_valid=True,
                claimed_status="successful",
                received_at="2026-05-01T00:06:00.000Z",
            )
        ]
        result = reconcile(
            ctx(
                orders=[order(booking_status="CONFIRMED")],
                payments=[payment(status="failed")],
                webhook_events=events,
            )
        )
        self.assertIn("WEBHOOK_PROVIDER_DISAGREEMENT", [f.mismatch_class for f in result.findings])

    def test_produces_a_stable_finding_key_across_two_runs(self):
        context = ctx(orders=[order(booking_status="CONFIRMED")], payments=[])
        first = reconcile(context).findings[0].finding_key
        second = reconcile(context).findings[0].finding_key
        self.assertEqual(first, second)

    def test_grace_period_confirmed_without_successful_payment(self):
        result = reconcile(
            ctx(
                orders=[order(booking_status="CONFIRMED", updated_at="2026-06-01T11:59:59.000Z")],
                payments=[],
                grace_period_ms=60 * 60 * 1000,
            )
        )
        self.assertEqual(result.findings, [])

        result = reconcile(
            ctx(
                orders=[order(booking_status="CONFIRMED", updated_at="2026-06-01T09:00:00.000Z")],
                payments=[],
                grace_period_ms=60 * 60 * 1000,
            )
        )
        self.assertEqual([f.mismatch_class for f in result.findings], ["CONFIRMED_WITHOUT_SUCCESSFUL_PAYMENT"])

    def test_incomplete_export_marks_the_run_inconclusive_and_suppresses_absence_based_findings(self):
        result = reconcile(ctx(orders=[order(booking_status="CONFIRMED")], payments=[], complete=False))
        self.assertEqual(result.status, "INCONCLUSIVE")
        self.assertIsNotNone(result.notes)
        self.assertEqual(result.findings, [])

    def test_incomplete_export_still_reports_presence_based_findings(self):
        result = reconcile(
            ctx(
                orders=[order(booking_status="CONFIRMED", amount_minor=10000)],
                payments=[payment(amount_minor=9500)],
                complete=False,
            )
        )
        self.assertEqual(result.status, "INCONCLUSIVE")
        self.assertEqual([f.mismatch_class for f in result.findings], ["AMOUNT_CURRENCY_MISMATCH"])


if __name__ == "__main__":
    unittest.main()
