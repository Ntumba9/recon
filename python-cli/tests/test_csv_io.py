import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from recon_cli.csv_io import CsvFormatError, read_orders_csv, read_payments_csv, read_webhooks_csv  # noqa: E402


def write_csv(tmpdir, name, text):
    path = os.path.join(tmpdir, name)
    with open(path, "w", newline="", encoding="utf-8") as f:
        f.write(text)
    return path


class CsvIoTest(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.mkdtemp(prefix="recon_csv_io_")

    def test_reads_a_well_formed_orders_csv(self):
        path = write_csv(
            self.tmpdir,
            "orders.csv",
            "reference,currency,amount_minor,booking_status,created_at,updated_at\n"
            "ord_1,zar,10000,CONFIRMED,2026-01-01T00:00:00.000Z,2026-01-02T00:00:00.000Z\n",
        )
        orders = read_orders_csv(path)
        self.assertEqual(len(orders), 1)
        self.assertEqual(orders[0].currency, "ZAR")
        self.assertEqual(orders[0].amount_minor, 10000)
        self.assertEqual(orders[0].updated_at, "2026-01-02T00:00:00.000Z")

    def test_orders_csv_updated_at_defaults_to_created_at_when_blank(self):
        path = write_csv(
            self.tmpdir,
            "orders.csv",
            "reference,currency,amount_minor,booking_status,created_at,updated_at\n"
            "ord_1,ZAR,10000,CONFIRMED,2026-01-01T00:00:00.000Z,\n",
        )
        orders = read_orders_csv(path)
        self.assertEqual(orders[0].updated_at, "2026-01-01T00:00:00.000Z")

    def test_rejects_an_unknown_booking_status(self):
        path = write_csv(
            self.tmpdir,
            "orders.csv",
            "reference,currency,amount_minor,booking_status,created_at\n"
            "ord_1,ZAR,10000,SOMETHING_ELSE,2026-01-01T00:00:00.000Z\n",
        )
        with self.assertRaises(CsvFormatError):
            read_orders_csv(path)

    def test_rejects_a_non_integer_amount(self):
        path = write_csv(
            self.tmpdir,
            "orders.csv",
            "reference,currency,amount_minor,booking_status,created_at\n"
            "ord_1,ZAR,100.50,CONFIRMED,2026-01-01T00:00:00.000Z\n",
        )
        with self.assertRaises(CsvFormatError):
            read_orders_csv(path)

    def test_rejects_a_missing_required_column(self):
        path = write_csv(
            self.tmpdir,
            "orders.csv",
            "reference,currency,amount_minor,created_at\nord_1,ZAR,10000,2026-01-01T00:00:00.000Z\n",
        )
        with self.assertRaises(CsvFormatError):
            read_orders_csv(path)

    def test_reads_a_well_formed_payments_csv_and_reports_row_count(self):
        path = write_csv(
            self.tmpdir,
            "payments.csv",
            "id,order_reference,amount_minor,currency,status,created_at\n"
            "pay_1,ord_1,10000,ZAR,successful,2026-01-01T00:00:00.000Z\n"
            "pay_2,ord_2,5000,ZAR,pending,2026-01-01T00:00:00.000Z\n",
        )
        payments, row_count = read_payments_csv(path)
        self.assertEqual(row_count, 2)
        self.assertEqual(len(payments), 2)
        self.assertEqual(payments[0].status, "successful")

    def test_rejects_an_unknown_payment_status(self):
        path = write_csv(
            self.tmpdir,
            "payments.csv",
            "id,order_reference,amount_minor,currency,status,created_at\n"
            "pay_1,ord_1,10000,ZAR,settled,2026-01-01T00:00:00.000Z\n",
        )
        with self.assertRaises(CsvFormatError):
            read_payments_csv(path)

    def test_webhooks_csv_is_optional_and_defaults_to_empty(self):
        self.assertEqual(read_webhooks_csv(None), [])

    def test_reads_a_well_formed_webhooks_csv(self):
        path = write_csv(
            self.tmpdir,
            "webhooks.csv",
            "event_id,provider_payment_id,order_reference,type,signature_valid,claimed_status,received_at\n"
            "evt_1,pay_1,ord_1,payment.succeeded,true,successful,2026-01-01T00:00:00.000Z\n",
        )
        events = read_webhooks_csv(path)
        self.assertEqual(len(events), 1)
        self.assertTrue(events[0].signature_valid)

    def test_rejects_an_invalid_signature_valid_value(self):
        path = write_csv(
            self.tmpdir,
            "webhooks.csv",
            "event_id,provider_payment_id,order_reference,type,signature_valid,claimed_status,received_at\n"
            "evt_1,pay_1,ord_1,payment.succeeded,yes,successful,2026-01-01T00:00:00.000Z\n",
        )
        with self.assertRaises(CsvFormatError):
            read_webhooks_csv(path)


if __name__ == "__main__":
    unittest.main()
