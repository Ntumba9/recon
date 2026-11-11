"""Offline reconciliation CLI. See python-cli/README.md for full usage,
CSV formats, and completeness-input documentation.

Exit codes: 0 for a completed run regardless of its reconciliation status
(SUCCESS/INCONCLUSIVE are both successful executions of the tool - this
mirrors `git status` exiting 0 on a dirty tree); 2 for a CLI-level error
(bad arguments, unreadable file, invalid CSV)."""

import argparse
import json
import sys
from typing import Optional, Tuple

from .csv_io import CsvFormatError, read_orders_csv, read_payments_csv, read_webhooks_csv
from .models import Finding, ReconcileContext, ReconcileResult
from .money import format_money
from .reconcile import reconcile
from .timeutil import now_iso


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="recon_cli",
        description=(
            "Offline reconciliation: compares an orders CSV against a provider settlement CSV using the "
            "same six mismatch classes as the TypeScript engine (see shared/mismatch-schema.json)."
        ),
    )
    parser.add_argument("orders_csv", help="Path to orders.csv (RECON's own bookings)")
    parser.add_argument("payments_csv", help="Path to payments.csv (the provider's settlement export)")
    parser.add_argument(
        "--webhooks",
        dest="webhooks_csv",
        default=None,
        help="Optional path to webhooks.csv - only needed for WEBHOOK_PROVIDER_DISAGREEMENT; omit if you have no webhook log",
    )
    parser.add_argument(
        "--now",
        dest="now",
        default=None,
        help="ISO 8601 UTC instant to treat as 'now' (default: the current time). Use this for reproducible runs.",
    )
    parser.add_argument(
        "--grace-period-ms",
        dest="grace_period_ms",
        type=int,
        default=0,
        help="Milliseconds a payment or pending booking is given before being flagged (default: 0)",
    )
    parser.add_argument(
        "--declared-total",
        dest="declared_total",
        type=int,
        default=None,
        help=(
            "The provider's own declared row count for payments.csv, if the export included one. A mismatch "
            "against the actual row count marks the run INCONCLUSIVE, the same way the TypeScript engine's "
            "live pagination check does."
        ),
    )
    parser.add_argument(
        "--mark-incomplete",
        dest="mark_incomplete_reason",
        default=None,
        metavar="REASON",
        help=(
            "Force the run INCONCLUSIVE with REASON, overriding --declared-total, when you know the export "
            "was partial for a reason the row count alone wouldn't reveal."
        ),
    )
    parser.add_argument(
        "--format",
        dest="output_format",
        choices=["table", "json"],
        default="table",
        help="Output format (default: table)",
    )
    return parser


def _determine_completeness(args, payment_row_count: int) -> Tuple[bool, Optional[str]]:
    if args.mark_incomplete_reason:
        return False, args.mark_incomplete_reason
    if args.declared_total is not None and args.declared_total != payment_row_count:
        reason = (
            f"Declared total ({args.declared_total}) disagrees with the {payment_row_count} payment row(s) "
            f"actually read from {args.payments_csv}"
        )
        return False, reason
    return True, None


def _finding_to_json(f: Finding) -> dict:
    return {
        "findingKey": f.finding_key,
        "mismatchClass": f.mismatch_class,
        "severity": f.severity,
        "orderReference": f.order_reference,
        "providerPaymentId": f.provider_payment_id,
        "currency": f.currency,
        "amountMinor": f.amount_minor,
        "evidence": f.evidence,
    }


def _result_to_json(result: ReconcileResult, notes: Optional[str]) -> dict:
    return {
        "status": result.status,
        "notes": notes,
        "findings": [_finding_to_json(f) for f in result.findings],
    }


def _print_table(result: ReconcileResult, notes: Optional[str]) -> None:
    print(f"Run status: {result.status}")
    if notes:
        print(f"Notes: {notes}")
    print(f"Findings: {len(result.findings)}")
    if not result.findings:
        return

    print("-" * 100)
    print(f"{'Mismatch class':<38} {'Order':<28} {'Payment':<14} Amount")
    print("-" * 100)
    for f in result.findings:
        amount = format_money(f.amount_minor, f.currency) if f.amount_minor is not None and f.currency else "-"
        print(f"{f.mismatch_class:<38} {(f.order_reference or '-'):<28} {(f.provider_payment_id or '-'):<14} {amount}")


def main(argv: Optional[list] = None) -> int:
    args = build_arg_parser().parse_args(argv)

    try:
        orders = read_orders_csv(args.orders_csv)
        payments, payment_row_count = read_payments_csv(args.payments_csv)
        webhook_events = read_webhooks_csv(args.webhooks_csv)
    except CsvFormatError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    except OSError as exc:
        print(f"error: could not read input file: {exc}", file=sys.stderr)
        return 2

    complete, incomplete_reason = _determine_completeness(args, payment_row_count)

    ctx = ReconcileContext(
        orders=orders,
        payments=payments,
        webhook_events=webhook_events,
        now=args.now or now_iso(),
        grace_period_ms=args.grace_period_ms,
        complete=complete,
    )
    result = reconcile(ctx)
    notes = incomplete_reason or result.notes

    if args.output_format == "json":
        print(json.dumps(_result_to_json(result, notes), indent=2))
    else:
        _print_table(result, notes)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
