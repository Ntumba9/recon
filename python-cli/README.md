# RECON Python CLI

An offline tool that compares an orders CSV against a provider settlement
CSV using the same six mismatch classes as the TypeScript engine
(`src/core/reconciler`), built from the standard library only (no
dependencies to install). It is meant for a business that has a provider's
settlement export as a flat file and wants to reconcile it without running
the rest of RECON.

**All data is synthetic.** Like the rest of RECON, this is a demo tool, not
a production reconciliation system.

## Parity with the TypeScript engine

Both implementations are checked, finding by finding (including the
cryptographic `findingKey`), against one frozen golden fixture
(`shared/fixtures/golden-findings.json`), generated from the TypeScript
engine's actual output (`npx tsx scripts/generate-golden-findings.ts`). See:

- `tests/unit/goldenFindings.test.ts` (TypeScript side)
- `python-cli/tests/test_parity.py` (this side - runs the real CLI as a
  subprocess, the full CSV-to-findings round trip)

If the two implementations ever disagree, one of these two tests fails. The
parity test is not a count of mismatch classes; it compares every field of
every finding, in order, against the same golden file.

## Usage

```bash
cd python-cli
python -m recon_cli orders.csv payments.csv [options]
```

```
positional arguments:
  orders_csv            Path to orders.csv (RECON's own bookings)
  payments_csv           Path to payments.csv (the provider's settlement export)

options:
  --webhooks WEBHOOKS_CSV
                         Optional path to webhooks.csv - only needed for
                         WEBHOOK_PROVIDER_DISAGREEMENT; omit if you have no
                         webhook log
  --now NOW              ISO 8601 UTC instant to treat as "now" (default:
                         the current time). Use this for reproducible runs.
  --grace-period-ms GRACE_PERIOD_MS
                         Milliseconds a payment or pending booking is given
                         before being flagged (default: 0)
  --declared-total DECLARED_TOTAL
                         The provider's own declared row count for
                         payments.csv, if the export included one.
  --mark-incomplete REASON
                         Force the run INCONCLUSIVE with REASON.
  --format {table,json}  Output format (default: table)
```

Exit codes: `0` for a completed run regardless of its reconciliation status
(`SUCCESS`/`INCONCLUSIVE` are both successful executions of the tool - the
same way `git status` exits `0` on a dirty tree); `2` for a CLI-level error
(bad arguments, unreadable file, invalid CSV).

## CSV formats

Money is always an integer in minor units (cents) - never a float, for the
same reason as `src/lib/money.ts`: floating point amounts are exactly the
kind of silent rounding bug a reconciliation tool exists to catch. Every
timestamp is ISO 8601 UTC with millisecond precision
(`2026-01-01T00:00:00.000Z`).

### `orders.csv` (required)

| Column | Required | Meaning |
| --- | --- | --- |
| `reference` | yes | Unique order reference |
| `currency` | yes | ISO currency code |
| `amount_minor` | yes | Integer amount in minor units |
| `booking_status` | yes | One of `PENDING`, `PAYMENT_PENDING`, `CONFIRMED`, `EXPIRED`, `CANCELLED` |
| `created_at` | yes | ISO 8601 UTC |
| `updated_at` | no | ISO 8601 UTC; defaults to `created_at` if blank/omitted |

### `payments.csv` (required - the provider's settlement export)

| Column | Required | Meaning |
| --- | --- | --- |
| `id` | yes | Provider payment id |
| `order_reference` | yes | Matches an `orders.csv` reference |
| `amount_minor` | yes | Integer amount in minor units |
| `currency` | yes | ISO currency code |
| `status` | yes | One of `pending`, `successful`, `failed`, `refunded` |
| `created_at` | yes | ISO 8601 UTC |
| `updated_at` | no | ISO 8601 UTC; defaults to `created_at` if blank/omitted |

### `webhooks.csv` (optional)

Only needed to exercise `WEBHOOK_PROVIDER_DISAGREEMENT`. If you have no
webhook log, omit `--webhooks` entirely - that rule simply produces no
findings, the same as an empty webhook log would in the TypeScript engine.

| Column | Required | Meaning |
| --- | --- | --- |
| `event_id` | yes | Unique event id |
| `provider_payment_id` | yes | Matches a `payments.csv` id |
| `order_reference` | no | May be blank |
| `type` | yes | e.g. `payment.succeeded` |
| `signature_valid` | yes | `true` or `false` - only `true` events are considered, mirroring the TypeScript rule, which ignores unverified webhook claims |
| `claimed_status` | yes | The status the webhook claimed |
| `received_at` | yes | ISO 8601 UTC |

## Completeness inputs

A real HTTP adapter can inspect live pagination to tell whether a provider
export is actually complete (see `src/core/provider-adapter/mockProviderAdapter.ts`).
A static CSV file has no pagination to inspect, so completeness here is
always declared, not detected automatically:

- **`--declared-total N`**: if the provider's own export states how many
  payment records it contains (e.g. in an accompanying manifest or report
  email), pass that count. A mismatch against the actual row count in
  `payments.csv` marks the run `INCONCLUSIVE` with an explanation - the same
  "declared total disagrees with what was returned" check the TypeScript
  adapter runs live against pagination.
- **`--mark-incomplete "<reason>"`**: force `INCONCLUSIVE` with the given
  reason, for when you know the export was partial for a reason the row
  count alone wouldn't reveal (e.g. a provider support ticket saying the
  export job was cancelled partway through).
- **Neither flag given**: the run is treated as `SUCCESS` - complete -
  since there is no live connection to double-check against. This is an
  inherent limitation of an offline file, not a guess; see the main
  README's "Honest limits".

There is no CLI equivalent of the TypeScript engine's `FAILED` status (a
provider that could not be reached at all): an unreadable or missing
`payments.csv` is a CLI-level error (exit code `2`), not a produced
reconciliation result, since there was never an export to reconcile against
in the first place.

## Tests

```bash
cd python-cli
python -m unittest discover -s tests -v
```

- `tests/test_rules.py` - each of the six rules, independently (parallel to `tests/unit/reconcile.test.ts`)
- `tests/test_csv_io.py` - CSV parsing and validation, including rejected rows
- `tests/test_parity.py` - the golden-fixture parity check described above
