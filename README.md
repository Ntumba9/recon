# RECON

[![CI](https://github.com/Ntumba9/recon/actions/workflows/ci.yml/badge.svg)](https://github.com/Ntumba9/recon/actions/workflows/ci.yml)

A local-first, free payment-reconciliation tool that finds discrepancies
between a business's own bookings and a payment provider's records.

**All data is synthetic.** RECON makes no real charges, stores no real
client data, and does not integrate with any real payment provider or
external account. It is not production software.

## Demo walkthrough

Real screenshots from the running local app, using only the synthetic
fixtures in `shared/fixtures/demo-scenarios.json`. Click an image to inspect
its full-size evidence and controls.

### Findings and evidence

The findings view shows the six mismatch classes across seven findings,
with severity, order/payment references, amounts, per-run evidence, and
Acknowledge / Resolve controls. Status changes annotate findings only;
they do not change bookings or payments.

![RECON findings with synthetic mismatch evidence and lifecycle controls](https://github.com/user-attachments/assets/8d22f80b-ada0-4895-8b83-023a606629c8)

### Browser-triggered reconciliation and run history

The run history shows a successful browser-triggered run, the complete
seven-finding demo run, and a deliberately `INCONCLUSIVE` run. The partial
export declares eight payments but returns seven, so absence-based
findings are suppressed instead of treating missing records as proof.
The browser-triggered run uses the normal grace period; the seeded demo
uses zero grace to exercise every scenario immediately.

![RECON run history with SUCCESS and INCONCLUSIVE outcomes and the reconciliation button](https://github.com/user-attachments/assets/78011fd5-01b1-4fac-877c-e2c0062baeaf)

### Finding lifecycle: acknowledge, resolve, and notes

Status changes are deliberate human actions with an investigation note -
nothing is ever auto-resolved, and no status change touches a booking or a
payment. Here the duplicate-payment finding is acknowledged with what the
provider export showed, the confirmed-without-payment finding is resolved
after manual correction, and the rest stay open. If a later successful run
detects a resolved finding's discrepancy again, it is set back to OPEN
automatically.

![RECON findings showing ACKNOWLEDGED and RESOLVED lifecycle states with investigation notes](https://github.com/user-attachments/assets/6e9fa8f7-85d9-4426-bd22-26a72b9850a1)

### Isolating one mismatch class

Class, severity and status filters keep the evidence readable. Here the
class filter isolates `WEBHOOK_PROVIDER_DISAGREEMENT`: the webhook claimed
`successful`, but the provider's own current record says `failed`. The
finding reports that disagreement rather than trusting the webhook.

![RECON findings filtered to WEBHOOK_PROVIDER_DISAGREEMENT, evidence showing claimed successful versus provider-recorded failed](https://github.com/user-attachments/assets/21c8a01a-3936-4601-8149-187d7cd4ac51)

### Offline parity with the Python CLI

The standard-library-only Python CLI reconciles CSV exports of the same
eight demo scenarios and returns the same seven findings - same mismatch
classes, orders, payments and amounts - as the TypeScript engine above.
Both implementations are checked field-by-field, including the
cryptographic `findingKey`, against one frozen golden fixture
(`shared/fixtures/golden-findings.json`), so this agreement is enforced in
CI, not just observed once.

![RECON Python CLI output matching the web engine's seven findings on the same scenarios](https://github.com/user-attachments/assets/553ef7ba-b955-4d37-bd0a-a2bda3d645f8)

### Verified demo output

`npm run demo` checked all eight scenarios against their expected findings:
clean and refunded payments produced no mismatch; lost webhook, duplicate
payment, wrong amount, confirmed-without-payment, aged pending, and
webhook/provider disagreement produced the expected findings.

```text
Run: status=SUCCESS, findings=7
All scenarios matched expected findings.
Incomplete-export run: status=INCONCLUSIVE (expected INCONCLUSIVE)
```

Run IDs and timestamps vary. These captures show a local demo, not a
hosted service or a real payment-provider integration. To reproduce it,
follow [Running the demo](#running-the-demo) below.

## Why webhook logs alone don't prove money correctness

A webhook is a message someone sent you, not a receipt you fetched
yourself. It can be lost in transit, delivered twice, arrive for the wrong
event, or simply disagree with the provider's own record if something
changed after it was sent. RECON treats every webhook delivery as an
unverified claim: it is logged, used to drive the obvious same-direction
booking update (a verified `payment.succeeded` event whose own amount and
currency agree with the order confirms it; a mismatched claim is still
logged but the order is left alone for the reconciler to flag), and then
**re-checked independently** by the reconciler, which fetches the
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
  and the status must be one of the three values above. The requested
  status must also be a transition the findings page's own buttons expose
  (OPEN -> ACKNOWLEDGED or RESOLVED; ACKNOWLEDGED -> RESOLVED or OPEN;
  RESOLVED -> OPEN) or leave status unchanged (a note-only edit) -
  anything else is rejected with `409 invalid_transition`
  (`src/core/findings/validTransition.ts`). Every failure from this
  endpoint and from `POST /api/runs` shares one shape,
  `{ error, message, requestId }` (`src/lib/apiError.ts`): `400`
  invalid_json/invalid_body, `404` not_found, `409` run_in_progress or
  invalid_transition, `413` payload_too_large, `415`
  unsupported_media_type, `403` forbidden_origin.
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

## Finding history

Every status or note change to a finding - manual or automatic - is also
recorded as an append-only `FindingHistoryEntry`
(`prisma/schema.prisma`), kept separate from the finding's current
(mutable) state so the trail itself can't be edited after the fact. History
exists only for changes made after this feature shipped; nothing is
fabricated for a finding's earlier life.

- **What's recorded**: the finding, the previous and new status, whether
  the change was `MANUAL` (through the status endpoint) or
  `RECONCILIATION` (an automatic reopen, which also records the
  reconciliation run that caused it), and what happened to the note -
  `UNCHANGED`, `SET` (with the new text), or `CLEARED`. A note-only edit
  (status unchanged) still gets its own entry.
- **Atomicity**: the `FindingRecord` write and its `FindingHistoryEntry`
  happen in the same database transaction (`src/core/findings/
  updateFindingStatus.ts` for manual changes, `src/core/reconciler/
  runReconciliation.ts` for automatic reopens) - either both commit or
  neither does.
- **Concurrency**: `FindingRecord.version` is an optimistic-concurrency
  token incremented on every write. A write is conditioned on the version
  it read; if another writer (a second manual request, or a reconciliation
  reopen) commits first, the condition matches zero rows, and the code
  re-reads the now-current row and retries its own request's intent
  against that fresh state, instead of overwriting it with stale data.
  Before every attempt, if the request would be a true no-op against the
  current state (identical resulting status and note), nothing is written
  and no history entry is created - this is what keeps a retried or
  losing-the-race request from producing a duplicate entry. Retries are
  bounded (3 attempts); sustained contention surfaces as a conflict rather
  than looping forever. This protects one finding's row against concurrent
  writers to itself - it is not a distributed lock and gives no
  cross-table serializability.
- **On the findings page**: each row has an expandable "History" disclosure
  (a native `<details>`/`<summary>` element - keyboard-operable and
  screen-reader-friendly with no script required) listing every entry
  newest first, with its timestamp, the status transition (or "unchanged"),
  the note change, and whether it was manual or automatic.
- **Ordering**: entries carry a monotonically increasing `sequence` in
  addition to their timestamp, so the timeline's order stays deterministic
  even if two entries share the same millisecond.

### Trying it out

With the demo running (see "Running the demo"), pick a finding id from
`/findings` or `GET /api/runs`, then:

```bash
# A note-only edit: status stays the same, only the note changes.
curl -X POST http://localhost:3005/api/findings/<id>/status \
  -H "Content-Type: application/json" \
  -d '{"status":"OPEN","note":"checked the provider dashboard"}'

# Acknowledge, then resolve - each a separate history entry.
curl -X POST http://localhost:3005/api/findings/<id>/status \
  -H "Content-Type: application/json" -d '{"status":"ACKNOWLEDGED"}'
curl -X POST http://localhost:3005/api/findings/<id>/status \
  -H "Content-Type: application/json" -d '{"status":"RESOLVED"}'
```

Reload `/findings` and open that row's "History" disclosure to see all
three entries, newest first. To see an automatic reopen, resolve a finding
that a later complete reconciliation run will detect again (e.g. the
`confirmed_no_payment` demo scenario), then trigger a run from `/runs` -
its history will show a `RECONCILIATION`-sourced entry referencing that
run's id.

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
- **Request hygiene on the two browser-facing mutation routes** (`POST
  /api/runs`, `POST /api/findings/:id/status`): a request whose `Origin`
  header doesn't match this app's own host is rejected with `403`, and a
  non-empty body must be declared `application/json` (`415` otherwise) -
  see `src/lib/httpGuards.ts`. **This is a same-origin check, not
  authentication**: it stops a cross-origin browser page from driving these
  endpoints with the browser's own ambient state (cookies, session), but
  anyone with direct network access to this unauthenticated local demo -
  curl, a script, another process on the machine - can still call them
  directly, since a request with no `Origin` header at all is always
  allowed. The provider webhook deliberately has no Origin/Content-Type
  check at all - it's authenticated by its HMAC signature instead, which an
  Origin header can't provide anyway for a server-to-server delivery.
- **Every request body, on all three POST routes, is capped at 64 KB**,
  read as a stream rather than trusted via `Content-Length` (so neither an
  absent nor a spoofed-smaller length header lets an oversized body
  through) - see `src/lib/httpGuards.ts`.

## Honest limits

- **Unauthenticated, local-only demo.** The findings page, the runs page,
  the webhook endpoint, the finding-status endpoint, and the run-trigger
  endpoint all have no auth. This is explicitly not meant to run anywhere
  but a local machine for this demo.
- **Two concurrent runs can never both start.** A partial unique index on
  `ReconciliationRun` (`finishedAt IS NULL`) means the database itself
  rejects a second concurrent run's insert - not a `findFirst`-then-create
  check racing against itself. What's still a heuristic, not a guarantee:
  a run that crashes mid-flight leaves its row "in progress" until the
  5-minute staleness timeout reaps it, during which a new run is correctly
  refused as `run_in_progress` even though nothing is actually running -
  acceptable for a single-user local demo, not a production SLA.
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
- **No snooze state.** Beyond the OPEN/ACKNOWLEDGED/RESOLVED lifecycle and
  its history (see "Finding history"), there is no way to temporarily
  suppress a finding from view.
- **History has no identity.** The demo has no authentication, so no entry
  is ever attributed to a person - only whether the change was a manual
  action or an automatic reconciliation reopen. See "Finding history" for
  what is and isn't recorded.

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
