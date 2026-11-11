"""Parity test: builds orders/payments/webhooks CSVs directly from the
shared demo scenarios (shared/fixtures/demo-scenarios.json), with the same
fixed "now", the same offset math, the same sequential payment IDs, and the
same deterministic webhook event IDs as tests/helpers/goldenFixtureBuilder.ts
builds for the TypeScript engine's own golden-fixture test. Then runs the
real CLI (python -m recon_cli, as a subprocess - the full CSV-to-findings
round trip, not just the inner reconcile() call) and compares its JSON
output, field by field including the cryptographic findingKey, against
shared/fixtures/golden-findings.json - the exact same file the TypeScript
engine is checked against. This is how the two independent implementations
are verified to agree: both against one frozen source of truth, not against
each other directly."""

import csv
import json
import os
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
CLI_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
FIXTURE_PATH = os.path.join(REPO_ROOT, "shared", "fixtures", "demo-scenarios.json")
GOLDEN_PATH = os.path.join(REPO_ROOT, "shared", "fixtures", "golden-findings.json")

FIXED_NOW = datetime(2026, 1, 1, 0, 0, 0, tzinfo=timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def _offset_timestamp(hours):
    if hours is None:
        return FIXED_NOW
    return FIXED_NOW + timedelta(hours=hours)


def _load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _build_csvs(tmpdir, scenarios, currency):
    orders_path = os.path.join(tmpdir, "orders.csv")
    payments_path = os.path.join(tmpdir, "payments.csv")
    webhooks_path = os.path.join(tmpdir, "webhooks.csv")

    seq = 1
    with open(orders_path, "w", newline="", encoding="utf-8") as orders_f, \
            open(payments_path, "w", newline="", encoding="utf-8") as payments_f, \
            open(webhooks_path, "w", newline="", encoding="utf-8") as webhooks_f:
        orders_writer = csv.writer(orders_f)
        payments_writer = csv.writer(payments_f)
        webhooks_writer = csv.writer(webhooks_f)

        orders_writer.writerow(["reference", "currency", "amount_minor", "booking_status", "created_at", "updated_at"])
        payments_writer.writerow(
            ["id", "order_reference", "amount_minor", "currency", "status", "created_at", "updated_at"]
        )
        webhooks_writer.writerow(
            ["event_id", "provider_payment_id", "order_reference", "type", "signature_valid", "claimed_status", "received_at"]
        )

        for scenario in scenarios:
            order = scenario["order"]
            timestamp = _iso(_offset_timestamp(order.get("createdAtOffsetHours")))
            orders_writer.writerow(
                [order["reference"], currency, order["amountMinor"], order["bookingStatus"], timestamp, timestamp]
            )

            scenario_payment_ids = []
            last_status = None
            for payment_spec in scenario["payments"]:
                payment_id = f"pay_{seq:06d}"
                seq += 1
                payments_writer.writerow(
                    [payment_id, order["reference"], payment_spec["amountMinor"], currency, payment_spec["status"], timestamp, timestamp]
                )
                scenario_payment_ids.append(payment_id)
                last_status = payment_spec["status"]

            if scenario.get("deliverWebhooks") and scenario_payment_ids:
                claimed_status = scenario.get("webhookOverrideStatus") or last_status
                webhook_type = (
                    "payment.refunded"
                    if claimed_status == "refunded"
                    else "payment.failed"
                    if claimed_status == "failed"
                    else "payment.succeeded"
                )
                webhooks_writer.writerow(
                    [
                        f"evt_{scenario['id']}_fixed",
                        scenario_payment_ids[-1],
                        order["reference"],
                        webhook_type,
                        "true",
                        claimed_status,
                        timestamp,
                    ]
                )

    return orders_path, payments_path, webhooks_path


def _normalize(findings):
    return [
        {
            "findingKey": f["findingKey"],
            "mismatchClass": f["mismatchClass"],
            "severity": f["severity"],
            "orderReference": f.get("orderReference"),
            "providerPaymentId": f.get("providerPaymentId"),
            "currency": f.get("currency"),
            "amountMinor": f.get("amountMinor"),
            "evidence": f.get("evidence"),
        }
        for f in findings
    ]


class GoldenParityTest(unittest.TestCase):
    def setUp(self):
        self.fixture = _load_json(FIXTURE_PATH)
        self.golden = _load_json(GOLDEN_PATH)
        self._tmpdir_obj = tempfile.TemporaryDirectory(prefix="recon_parity_")
        self.tmpdir = self._tmpdir_obj.name
        self.addCleanup(self._tmpdir_obj.cleanup)
        self.orders_path, self.payments_path, self.webhooks_path = _build_csvs(
            self.tmpdir, self.fixture["scenarios"], self.fixture["currency"]
        )

    def _run_cli(self, complete: bool) -> dict:
        args = [
            sys.executable,
            "-m",
            "recon_cli",
            self.orders_path,
            self.payments_path,
            "--webhooks",
            self.webhooks_path,
            "--now",
            _iso(FIXED_NOW),
            "--grace-period-ms",
            "0",
            "--format",
            "json",
        ]
        if not complete:
            args += ["--mark-incomplete", "simulated incomplete export for parity testing"]

        env = dict(os.environ)
        env["PYTHONPATH"] = CLI_ROOT + os.pathsep + env.get("PYTHONPATH", "")
        proc = subprocess.run(args, cwd=CLI_ROOT, env=env, capture_output=True, text=True)
        self.assertEqual(proc.returncode, 0, msg=f"CLI failed: stdout={proc.stdout!r} stderr={proc.stderr!r}")
        return json.loads(proc.stdout)

    def test_matches_golden_fixture_for_a_complete_export(self):
        output = self._run_cli(complete=True)
        self.assertEqual(output["status"], "SUCCESS")
        self.assertEqual(_normalize(output["findings"]), self.golden["complete"]["findings"])

    def test_matches_golden_fixture_for_an_incomplete_export(self):
        output = self._run_cli(complete=False)
        self.assertEqual(output["status"], "INCONCLUSIVE")
        self.assertEqual(_normalize(output["findings"]), self.golden["incomplete"]["findings"])


if __name__ == "__main__":
    unittest.main()
