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
- **Python** (future, not built yet) - an offline CLI that compares an
  orders CSV against a provider settlement CSV using the same mismatch
  classes. `shared/mismatch-schema.json` and `shared/fixtures/` define that
  contract now so the Python port can be tested against the exact same
  scenarios and expected findings as the TypeScript engine.

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
- A partial or unreachable provider export means the run is `INCONCLUSIVE`/`FAILED`, never "no payment found" - absence of a record in a partial export is not proof a payment doesn't exist.

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
  (see Limits below), there is no rate limiting on the webhook endpoint,
  and the mock provider has no analogous protections of its own since it
  represents a third party RECON doesn't control.

## Honest limits

- **Unauthenticated, local-only demo.** The findings page and webhook
  endpoint have no auth. This is explicitly not meant to run anywhere but
  a local machine for this demo.
- **No automated remediation.** RECON never issues refunds, retries
  charges, or changes a booking on its own. Every finding is for a human
  to act on.
- **The mock provider is a mock.** It is a plausible, documented HTTP
  contract for demonstration - not a real integration with any provider.
- **No fault injection for partial provider outages.** The adapter
  correctly turns a total provider failure (unreachable, non-2xx) into a
  `FAILED` run, but the mock provider itself doesn't simulate a provider
  that is up but returning truncated data mid-export.
- **Finding lifecycle is minimal.** Findings persist with stable identity
  and run history, but there's no acknowledge/resolve/snooze workflow (see
  Growth below).

## Running the demo

**One command**, from the repo root:

```bash
docker compose up --build
```

This starts Postgres, the mock provider, and the app; applies migrations;
seeds both independent stores from `shared/fixtures/demo-scenarios.json`
(including a successful payment whose webhook is deliberately never
delivered); runs a reconciliation; and prints an expected-vs-actual table
for every scenario to the `app` container's logs. Once it's up:

- Findings UI: http://localhost:3005/findings (mapped from the container's port 3000; change the host-side port in `docker-compose.yml` if 3005 is also taken)
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
npm run secret-scan
```

## Growth (structure in place, not built)

- **Python CSV CLI** - an offline tool comparing an orders CSV with a
  provider settlement CSV against `shared/mismatch-schema.json` and the
  golden fixtures in `shared/fixtures/`, for byte-for-byte parity testing
  with the TypeScript engine.
- **Findings digest email** - a periodic summary of open findings.
- **Scheduled runs** - running the reconciler on a timer instead of on
  demand.
- **Finding lifecycle** - acknowledge/resolve/snooze states on top of the
  existing stable identity.
- **A second provider adapter** - proving `ProviderAdapter` generalizes
  beyond the mock.
- **Multi-tenancy** - scoping orders, runs, and findings per business.
