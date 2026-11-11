# RECON

A local-first, free payment-reconciliation tool that finds discrepancies
between a business's own bookings and a payment provider's records.

**All data is synthetic.** RECON makes no real charges, stores no real
client data, and does not integrate with any real payment provider or
external account. It is not production software.

## Why webhook logs alone don't prove money correctness

A webhook is a message someone sent you, not a receipt you fetched
yourself. It can be lost in transit, delivered twice, arrive for the wrong
event, or simply disagree with the provider's own record if something
changed after it was sent. RECON treats every webhook delivery as an
unverified claim: it is logged, used to drive the obvious same-direction
booking update (a verified `payment.succeeded` event confirms its order),
and then **re-checked independently** by the reconciler, which fetches the
provider's own payment records directly through its API and compares them
against bookings. If the webhook and the provider disagree, that is itself
a finding (`WEBHOOK_PROVIDER_DISAGREEMENT`), not something papered over.

This is also why the orders store and the mock provider's store are kept
completely independent (different processes, different data, reachable
only over HTTP) - nothing lets one silently stand in for the other.

## Architecture

```
┌──────────────┐        HTTP (adapter)        ┌──────────────────────┐
│  Next.js app │ ───────────────────────────▶ │  Mock provider        │
│  (TypeScript)│ ◀─────────────────────────── │  (plain JS, Express)  │
│              │   webhook push (signed)       │  independent store    │
│  Postgres    │                               └──────────────────────┘
│  (Prisma)    │
└──────────────┘
```

- **Orders** and the **mock provider** have independent stores. The
  reconciler only ever learns the provider's state by calling its HTTP API
  (`src/core/provider-adapter`) - never by trusting what a webhook said.
- **Webhook intake** (`src/app/api/webhooks/provider`, `src/core/webhooks`)
  validates the payload shape, verifies a raw-body HMAC signature with a
  constant-time comparison, rejects stale/replayed timestamps, and dedups
  durably by `eventId` inside a database transaction. A duplicate delivery
  is a harmless no-op, not an error.
- **The reconciler** (`src/core/reconciler`) is a pure function from
  (orders, provider payments, webhook log, now, grace period) to a list of
  findings. Each mismatch class is one small rule module under
  `src/core/reconciler/rules`.
- **Runs and findings** are persisted with a stable identity
  (`FindingRecord.findingKey`, a hash of the mismatch class and its natural
  keys) so reruns update `firstSeen`/`lastSeen` instead of duplicating,
  while `FindingOccurrence` preserves per-run evidence history.
- **The findings page** (`/findings`) is read-only: it filters and displays
  evidence. There are no refund, retry, or booking-correction actions
  anywhere in the app.

### Language roles

- **TypeScript** - the Next.js app and the reconciliation engine.
- **JavaScript** (`mock-provider/`) - a plain Node/Express simulator of a
  payment provider's HTTP API and webhook delivery, with its own in-memory
  store. It is a mock contract, not an integration with any real provider.
- **Python** (`python-cli/`) - an offline, standard-library-only CLI that
  compares an orders CSV against a provider settlement CSV using the same
  six mismatch classes. Checked for parity against the TypeScript engine
  field-by-field (not just finding-class counts) against one frozen golden
  fixture - see `python-cli/README.md` and "Reconciliation runs" below.

## Mismatch classes

| Class | Meaning |
| --- | --- |
| `SUCCESSFUL_PAYMENT_NOT_CONFIRMED` | The provider shows a successful payment, but the booking isn't `CONFIRMED`. |
| `CONFIRMED_WITHOUT_SUCCESSFUL_PAYMENT` | The booking is `CONFIRMED`, but the provider has no successful payment for it. |
| `DUPLICATE_SUCCESSFUL_PAYMENT` | More than one successful payment is recorded against the same order. |
| `AMOUNT_CURRENCY_MISMATCH` | A successful payment's amount or currency doesn't match the order's. |
| `AGED_PENDING_BOOKING` | A pending booking has sat unpaid well past the grace period - flagged for investigation, never auto-cancelled. |
| `WEBHOOK_PROVIDER_DISAGREEMENT` | A webhook's claimed status for a payment no longer matches the provider's own current record. |

Notes that shape every rule:

- `pending` is never treated as `successful`.
- A `refunded` payment is resolved money, not missing money, and is never flagged as a mismatch by itself.
- A partial or unreachable provider export means the run is `INCONCLUSIVE`/`FAILED`, never "no payment found" - absence of a record in a partial export is not proof a payment doesn't exist. Concretely: `CONFIRMED_WITHOUT_SUCCESSFUL_PAYMENT` and `AGED_PENDING_BOOKING` are the two classes that rely on absence, so both are suppressed outright whenever the provider export isn't known to be complete (see "Run outcomes" below). The other four classes rely on the presence of a specific record, which a partial export doesn't call into question, so they still fire normally.
- `CONFIRMED_WITHOUT_SUCCESSFUL_PAYMENT` also respects the grace period, measured from the order's `updatedAt`: a booking that was only just confirmed isn't flagged the instant it's checked, since the provider or the webhook that would corroborate it may simply not have caught up yet.

### Run outcomes

A run's `status` is `SUCCESS`, `INCONCLUSIVE`, or `FAILED`:

- `FAILED` - the provider couldn't be reached at all, or returned a non-2xx response. No findings are produced.
- `INCONCLUSIVE` - the provider responded, but its export is self-reportedly partial: pagination returned a malformed page, the response wasn't valid JSON, or its declared total disagreed with the number of records actually returned (`src/core/provider-adapter/mockProviderAdapter.ts`). Presence-based findings are still reported; absence-based ones are suppressed, and the run's `notes` explain why.
- `SUCCESS` - the export was complete and every rule ran normally.

The mock provider can simulate a partial export on demand: `POST /dev/simulate-truncation` with `{ "active": true }` makes every `/payments` page declare a `total` higher than what pagination will ever return. `scripts/demo.ts` exercises this as its own step, separate from the main scenario table, so the two don't get confused with each other.

## Reconciliation runs

A run can be started from the browser, not only from the demo script:

- **`/runs`** lists every `ReconciliationRun` - window, status, completeness,
  note count, and finding count - newest first, and links back to
  `/findings`. `/findings` links to `/runs` too.
- **"Run reconciliation"** on that page calls `POST /api/runs`, which runs
  the exact same reconciler the demo script and the Python CLI are checked
  against. Loading, error, and result states are all shown as they actually
  are: a `FAILED` or `INCONCLUSIVE` result is never hidden or rephrased as
  success.
- **Default window**: when no window is given, the window is derived from
  the oldest scenario in `shared/fixtures/demo-scenarios.json` plus a fixed
  safety margin (`src/core/reconciler/defaultWindow.ts`) - not an arbitrary
  constant. `scripts/demo.ts` uses this same function, so the two can't
  disagree about what "the default window" means.
- **Preventing duplicate/concurrent runs**: the button disables itself while
  a request is in flight, and the server independently refuses a second
  concurrent trigger with `409 run_in_progress` (an in-process flag closes
  the common double-click race; a database check against any run with no
  `finishedAt` closes it across processes/restarts too, with a 5-minute
  staleness timeout so one abandoned run can't block new runs forever - see
  `src/app/api/runs/route.ts`).
- **No authentication**, same as every other route in this demo - see
  "Honest limits".

## Finding lifecycle

Every `FindingRecord` carries a `status` - `OPEN`, `ACKNOWLEDGED`, or
`RESOLVED` - plus an optional `note` and `statusChangedAt`. These fields
annotate the finding only; nothing in the lifecycle ever writes to an
`Order` or a payment, and there is still no refund, retry, or booking
correction anywhere in RECON.

- **Changing status**: `POST /api/findings/:id/status` with a JSON body
  `{ "status": "ACKNOWLEDGED" | "RESOLVED" | "OPEN", "note"?: string | null }`.
  The payload is validated (`src/core/findings/statusTransitionSchema.ts`)
  and the status must be one of the three values above.
- **Note contract**: omitting `note` from the body preserves the finding's
  existing note untouched; `"note": null` or `"note": ""` (empty after
  trimming) explicitly clears it; `"note": "<text>"` replaces it. The
  findings page's note field is prefilled with the current note, so leaving
  it as-is and clicking a status button preserves it, and a "Clear note"
  button sends the explicit-clear form without changing status.
- **On the findings page**: a status filter alongside the existing
  mismatch-class and severity filters, the current status and note shown
  per row, and action buttons (Acknowledge / Resolve / Reopen / Clear note)
  that call the endpoint above.
- **Reopening**: if a `RESOLVED` finding's discrepancy is detected again in
  a later `SUCCESS` run, it's automatically set back to `OPEN` and the new
  occurrence is recorded - a resolved issue that comes back isn't silently
  left resolved. An `INCONCLUSIVE` run never does this, even for a
  presence-based finding that still shows up in its output: only a run
  that completed normally can be trusted to say a resolved problem is
  truly back.
- **Nothing is ever auto-resolved.** The only automatic transition is the
  reopen above; moving a finding to `ACKNOWLEDGED` or `RESOLVED` is always
  a deliberate action through the status endpoint.

## Threat model

- **Webhook spoofing / tampering** - mitigated by HMAC-SHA256 over the raw
  body with a constant-time comparison; a tampered body or wrong secret
  fails verification and is rejected before touching the database.
- **Replay** - a timestamp outside a tolerance window is rejected
  regardless of signature validity; a valid-but-old signed request can't be
  resent to re-trigger processing.
- **Duplicate delivery** - `eventId` is a database-level unique constraint,
  so even a race between two identical deliveries can only ever insert one
  event; the second is treated as a harmless duplicate.
- **Partial multi-write failures** - the webhook's event-log insert and its
  booking-confirmation update happen in one transaction; either both
  commit or neither does.
- **Out of scope for this demo**: the findings UI has no authentication
  (see Limits below), there is no rate limiting on the webhook endpoint, the
  finding-status endpoint, or the run-trigger endpoint, and the mock
  provider has no analogous protections of its own since it represents a
  third party RECON doesn't control.

## Honest limits

- **Unauthenticated, local-only demo.** The findings page, the runs page,
  the webhook endpoint, the finding-status endpoint, and the run-trigger
  endpoint all have no auth. This is explicitly not meant to run anywhere
  but a local machine for this demo.
- **Run concurrency is best-effort.** The in-process flag and database
  check that prevent overlapping runs (see "Reconciliation runs") cover a
  double-click and a crashed/restarted process, but a run started by a
  genuinely different process within the 5-minute staleness window can
  still race past both guards in principle - acceptable for a single-user
  local demo, not a production concurrency control.
- **The Python CLI can't detect an incomplete export on its own.** A static
  CSV file has no live pagination to double-check against, so completeness
  must be declared (`--declared-total` or `--mark-incomplete`); with
  neither flag, the run is treated as complete. See `python-cli/README.md`.
- **No automated remediation.** RECON never issues refunds, retries
  charges, or changes a booking on its own. Every finding is for a human
  to act on, including every lifecycle status change.
- **The mock provider is a mock.** It is a plausible, documented HTTP
  contract for demonstration - not a real integration with any provider.
- **Truncation simulation is coarse.** `/dev/simulate-truncation` models
  one specific failure mode (a declared total that doesn't match what
  pagination returns); it doesn't simulate other partial-export shapes,
  such as a page that times out mid-response.
- **No snooze state, and no history of past status changes.** A finding
  remembers only its current status, note, and when that status last
  changed - not who changed it or what it was before.

## Running the demo

**One command**, from the repo root:

```bash
docker compose up --build
```

This starts Postgres, the mock provider, and the app; applies migrations;
seeds both independent stores from `shared/fixtures/demo-scenarios.json`
(including a successful payment whose webhook is deliberately never
delivered); runs a reconciliation; prints an expected-vs-actual table for
every scenario; and then separately turns on truncation simulation on the
mock provider and runs a second reconciliation to show it come back
`INCONCLUSIVE` - all to the `app` container's logs. Once it's up:

- Findings UI: http://localhost:3005/findings (mapped from the container's port 3000; change the host-side port in `docker-compose.yml` if 3005 is also taken)
- Run history / trigger a run: http://localhost:3005/runs
- Mock provider health check: http://localhost:4000/health

### Running without Docker

```bash
npm install
npm --prefix mock-provider install
cp .env.example .env               # edit DATABASE_URL etc. if needed
npx prisma migrate dev
npm run mock-provider &             # terminal 1
npm run dev &                       # terminal 2
npm run demo                        # terminal 3 - seeds both stores and reconciles
```

### Tests

```bash
npm test          # unit + integration (integration needs DATABASE_URL set to a real Postgres)
npm run typecheck
npm run lint
npm run secret-scan
```

Python CLI tests (standard library `unittest`, no install step):

```bash
cd python-cli
python -m unittest discover -s tests -v
```

CI also runs a bounded Docker Compose smoke test: `docker compose up --build`
for real, against the actual containers, asserting the same expected-vs-
actual scenario table and incomplete-export behavior `scripts/demo.ts`
prints locally (see `.github/workflows/ci.yml`), with logs collected on
failure and the stack always torn down afterward.

## Growth (structure in place, not built)

- **Findings digest email** - a periodic summary of open findings.
- **Scheduled runs** - running the reconciler on a timer instead of on
  demand.
- **Snooze state and status history** - beyond the OPEN/ACKNOWLEDGED/RESOLVED
  lifecycle that exists now.
- **A second provider adapter** - proving `ProviderAdapter` generalizes
  beyond the mock.
- **Multi-tenancy** - scoping orders, runs, and findings per business.
