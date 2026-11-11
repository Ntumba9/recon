"""Data shapes mirroring src/core/reconciler/types.ts. Every timestamp field
is an ISO 8601 UTC string (see timeutil.py); every money field is an
integer in minor units (see money.py)."""

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

VALID_BOOKING_STATUSES = ("PENDING", "PAYMENT_PENDING", "CONFIRMED", "EXPIRED", "CANCELLED")
VALID_PAYMENT_STATUSES = ("pending", "successful", "failed", "refunded")

#: Mismatch classes whose evidence is "no matching record was found" - unsafe
#: to report from an incomplete provider export. Mirrors
#: ABSENCE_BASED_MISMATCH_CLASSES in src/core/reconciler/types.ts.
ABSENCE_BASED_MISMATCH_CLASSES = ("CONFIRMED_WITHOUT_SUCCESSFUL_PAYMENT", "AGED_PENDING_BOOKING")


@dataclass
class Order:
    reference: str
    currency: str
    amount_minor: int
    booking_status: str
    created_at: str
    updated_at: str


@dataclass
class Payment:
    id: str
    order_reference: str
    amount_minor: int
    currency: str
    status: str
    created_at: str
    updated_at: str


@dataclass
class WebhookEvent:
    event_id: str
    provider_payment_id: str
    order_reference: Optional[str]
    type: str
    signature_valid: bool
    claimed_status: str
    received_at: str


@dataclass
class Finding:
    finding_key: str
    mismatch_class: str
    severity: str
    order_reference: Optional[str]
    provider_payment_id: Optional[str]
    currency: Optional[str]
    amount_minor: Optional[int]
    evidence: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ReconcileContext:
    orders: List[Order]
    payments: List[Payment]
    webhook_events: List[WebhookEvent]
    now: str
    grace_period_ms: int
    complete: bool


@dataclass
class ReconcileResult:
    status: str
    findings: List[Finding]
    notes: Optional[str] = None
