import fs from "fs";
import path from "path";
import type { ProviderPayment } from "@/core/provider-adapter/types";
import type { Finding, OrderRecord, ReconcileContext, WebhookEventRecord } from "@/core/reconciler/types";

/**
 * Fixed reference instant for the golden parity fixture (see
 * shared/fixtures/golden-findings.json). Using a fixed "now" instead of
 * live Date.now() is what makes the fixture reproducible: every evidence
 * field derived from elapsed time (ageMs, ageSinceUpdateMs, ...) comes out
 * byte-identical on every regeneration and in both the TypeScript engine's
 * own test (tests/unit/goldenFindings.test.ts) and the Python CLI's parity
 * test (python-cli/tests/test_parity.py).
 */
export const FIXED_NOW = new Date("2026-01-01T00:00:00.000Z");

interface FixtureScenario {
  id: string;
  order: { reference: string; amountMinor: number; bookingStatus: string; createdAtOffsetHours?: number };
  payments: Array<{ amountMinor: number; status: string }>;
  deliverWebhooks: boolean;
  webhookOverrideStatus?: string;
}

interface DemoFixture {
  currency: string;
  scenarios: FixtureScenario[];
}

export function loadDemoScenarios(): DemoFixture {
  const fixturePath = path.join(__dirname, "..", "..", "shared", "fixtures", "demo-scenarios.json");
  return JSON.parse(fs.readFileSync(fixturePath, "utf8"));
}

function offsetTimestamp(hours: number | undefined): Date {
  if (hours === undefined) return FIXED_NOW;
  return new Date(FIXED_NOW.getTime() + hours * 60 * 60 * 1000);
}

/**
 * Builds deterministic orders/payments/webhook events directly from the
 * shared demo scenarios, pinned to FIXED_NOW instead of live Date.now() and
 * with sequential, deterministic payment/event IDs. This is NOT a replay of
 * the live seed script, demo script, or mock-provider HTTP seeding path
 * (which use real timestamps and random IDs for an actual running demo) -
 * it exists solely to produce one frozen, reproducible input so the
 * TypeScript engine and the Python CLI can both be checked, field by field,
 * against the exact same golden output.
 */
export function buildGoldenContext(complete: boolean): ReconcileContext {
  const { currency, scenarios } = loadDemoScenarios();
  const orders: OrderRecord[] = [];
  const payments: ProviderPayment[] = [];
  const webhookEvents: WebhookEventRecord[] = [];
  let seq = 1;

  for (const scenario of scenarios) {
    const timestamp = offsetTimestamp(scenario.order.createdAtOffsetHours);
    orders.push({
      reference: scenario.order.reference,
      currency,
      amountMinor: scenario.order.amountMinor,
      bookingStatus: scenario.order.bookingStatus as OrderRecord["bookingStatus"],
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    const scenarioPayments: ProviderPayment[] = [];
    for (const paymentSpec of scenario.payments) {
      const id = `pay_${String(seq).padStart(6, "0")}`;
      seq += 1;
      const payment: ProviderPayment = {
        id,
        orderReference: scenario.order.reference,
        amountMinor: paymentSpec.amountMinor,
        currency,
        status: paymentSpec.status as ProviderPayment["status"],
        createdAt: timestamp.toISOString(),
        updatedAt: timestamp.toISOString(),
      };
      payments.push(payment);
      scenarioPayments.push(payment);
    }

    if (scenario.deliverWebhooks && scenarioPayments.length > 0) {
      const last = scenarioPayments[scenarioPayments.length - 1]!;
      const claimedStatus = scenario.webhookOverrideStatus || last.status;
      const type =
        claimedStatus === "refunded"
          ? "payment.refunded"
          : claimedStatus === "failed"
            ? "payment.failed"
            : "payment.succeeded";
      webhookEvents.push({
        eventId: `evt_${scenario.id}_fixed`,
        providerPaymentId: last.id,
        orderReference: last.orderReference,
        type,
        signatureValid: true,
        receivedAt: timestamp,
        claimedStatus,
      });
    }
  }

  return { orders, payments, webhookEvents, now: FIXED_NOW, gracePeriodMs: 0, complete };
}

export interface NormalizedFinding {
  findingKey: string;
  mismatchClass: string;
  severity: string;
  orderReference: string | null;
  providerPaymentId: string | null;
  currency: string | null;
  amountMinor: number | null;
  evidence: Record<string, unknown>;
}

export function normalizeFindings(findings: Finding[]): NormalizedFinding[] {
  return findings.map((f) => ({
    findingKey: f.findingKey,
    mismatchClass: f.mismatchClass,
    severity: f.severity,
    orderReference: f.orderReference,
    providerPaymentId: f.providerPaymentId,
    currency: f.currency,
    amountMinor: f.amountMinor,
    evidence: f.evidence,
  }));
}
