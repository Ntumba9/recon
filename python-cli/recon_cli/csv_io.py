"""CSV reading and validation for the three input files. See
python-cli/README.md for the full column reference; the short version:

orders.csv (required): reference,currency,amount_minor,booking_status,
    created_at,updated_at (updated_at optional, defaults to created_at)
payments.csv (required, the provider's settlement export): id,
    order_reference,amount_minor,currency,status,created_at,updated_at
    (updated_at optional, defaults to created_at)
webhooks.csv (optional - only needed for WEBHOOK_PROVIDER_DISAGREEMENT):
    event_id,provider_payment_id,order_reference,type,signature_valid,
    claimed_status,received_at

All money fields are integers in minor units (never floats - see money.py).
All timestamp fields are ISO 8601 UTC (see timeutil.py)."""

import csv
from typing import List, Optional, Tuple

from .models import VALID_BOOKING_STATUSES, VALID_PAYMENT_STATUSES, Order, Payment, WebhookEvent

REQUIRED_ORDER_FIELDS = ["reference", "currency", "amount_minor", "booking_status", "created_at"]
REQUIRED_PAYMENT_FIELDS = ["id", "order_reference", "amount_minor", "currency", "status", "created_at"]
REQUIRED_WEBHOOK_FIELDS = ["event_id", "provider_payment_id", "type", "signature_valid", "claimed_status", "received_at"]


class CsvFormatError(Exception):
    """A CSV file is missing a required column, or a row fails validation."""


def _read_rows(path: str) -> List[dict]:
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def _require_columns(rows: List[dict], required: List[str], file_label: str) -> None:
    if not rows:
        return
    missing = [c for c in required if c not in rows[0]]
    if missing:
        raise CsvFormatError(f"{file_label}: missing required column(s): {', '.join(missing)}")


def _parse_int(value: str, field_name: str, file_label: str, row_label: str) -> int:
    try:
        return int(value)
    except (TypeError, ValueError) as exc:
        raise CsvFormatError(f"{file_label}: '{field_name}' must be an integer for {row_label}, got {value!r}") from exc


def read_orders_csv(path: str) -> List[Order]:
    rows = _read_rows(path)
    _require_columns(rows, REQUIRED_ORDER_FIELDS, "orders.csv")

    orders: List[Order] = []
    for row in rows:
        reference = row["reference"].strip()
        status = row["booking_status"].strip()
        if status not in VALID_BOOKING_STATUSES:
            raise CsvFormatError(
                f"orders.csv: unknown booking_status '{status}' for reference '{reference}' "
                f"(expected one of {', '.join(VALID_BOOKING_STATUSES)})"
            )
        created_at = row["created_at"].strip()
        updated_at = (row.get("updated_at") or "").strip() or created_at
        orders.append(
            Order(
                reference=reference,
                currency=row["currency"].strip().upper(),
                amount_minor=_parse_int(row["amount_minor"], "amount_minor", "orders.csv", f"reference '{reference}'"),
                booking_status=status,
                created_at=created_at,
                updated_at=updated_at,
            )
        )
    return orders


def read_payments_csv(path: str) -> Tuple[List[Payment], int]:
    """Returns (payments, row_count). row_count is the literal number of data
    rows read - the actual count a --declared-total completeness check is
    compared against, mirroring the TypeScript adapter's live pagination
    total-vs-returned-count check."""
    rows = _read_rows(path)
    _require_columns(rows, REQUIRED_PAYMENT_FIELDS, "payments.csv")

    payments: List[Payment] = []
    for row in rows:
        payment_id = row["id"].strip()
        status = row["status"].strip()
        if status not in VALID_PAYMENT_STATUSES:
            raise CsvFormatError(
                f"payments.csv: unknown status '{status}' for id '{payment_id}' "
                f"(expected one of {', '.join(VALID_PAYMENT_STATUSES)})"
            )
        created_at = row["created_at"].strip()
        updated_at = (row.get("updated_at") or "").strip() or created_at
        payments.append(
            Payment(
                id=payment_id,
                order_reference=row["order_reference"].strip(),
                amount_minor=_parse_int(row["amount_minor"], "amount_minor", "payments.csv", f"id '{payment_id}'"),
                currency=row["currency"].strip().upper(),
                status=status,
                created_at=created_at,
                updated_at=updated_at,
            )
        )
    return payments, len(rows)


def read_webhooks_csv(path: Optional[str]) -> List[WebhookEvent]:
    """Optional: a missing path simply means WEBHOOK_PROVIDER_DISAGREEMENT
    produces no findings, the same as an empty webhook log would."""
    if not path:
        return []

    rows = _read_rows(path)
    _require_columns(rows, REQUIRED_WEBHOOK_FIELDS, "webhooks.csv")

    events: List[WebhookEvent] = []
    for row in rows:
        event_id = row["event_id"].strip()
        signature_flag = row["signature_valid"].strip().lower()
        if signature_flag not in ("true", "false"):
            raise CsvFormatError(
                f"webhooks.csv: signature_valid must be 'true' or 'false' for event_id '{event_id}', "
                f"got {row['signature_valid']!r}"
            )
        order_reference = (row.get("order_reference") or "").strip() or None
        events.append(
            WebhookEvent(
                event_id=event_id,
                provider_payment_id=row["provider_payment_id"].strip(),
                order_reference=order_reference,
                type=row["type"].strip(),
                signature_valid=signature_flag == "true",
                claimed_status=row["claimed_status"].strip(),
                received_at=row["received_at"].strip(),
            )
        )
    return events
