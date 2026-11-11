"""Mirrors src/core/reconciler/index.ts: a pure comparison, given orders,
the full set of provider payments, and the webhook log, that produces
findings. Takes no action beyond reporting - no refunds, retries, or
booking corrections happen here, in the TypeScript engine, or anywhere else
in RECON."""

from .models import ReconcileContext, ReconcileResult
from .rules import RULES

INCOMPLETE_EXPORT_NOTES = (
    "Provider export for this window was incomplete or its declared total disagreed with what was fetched. "
    "Findings that depend on a payment's absence (CONFIRMED_WITHOUT_SUCCESSFUL_PAYMENT, AGED_PENDING_BOOKING) "
    "were suppressed for this run."
)


def reconcile(ctx: ReconcileContext) -> ReconcileResult:
    findings = []
    for rule in RULES:
        findings.extend(rule(ctx))

    # Stable, readable ordering: by mismatch class, then by order reference -
    # matches the TypeScript engine's sort exactly.
    findings.sort(key=lambda f: (f.mismatch_class, f.order_reference or ""))

    if not ctx.complete:
        return ReconcileResult(status="INCONCLUSIVE", findings=findings, notes=INCOMPLETE_EXPORT_NOTES)

    return ReconcileResult(status="SUCCESS", findings=findings)
