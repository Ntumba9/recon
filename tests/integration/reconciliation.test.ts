import fs from "fs";
import path from "path";
import { PrismaClient, type BookingStatus } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sign } from "../../mock-provider/signature.js";
import { handleWebhook } from "@/core/webhooks/handleWebhook";
import { runReconciliation } from "@/core/reconciler/runReconciliation";
import type { ProviderAdapter, ProviderPayment, ProviderPaymentStatus } from "@/core/provider-adapter/types";

const SECRET = "whsec_integration_test_secret_0123456789";

interface Scenario {
  id: string;
  order: { reference: string; amountMinor: number; bookingStatus: string; createdAtOffsetHours?: number };
  payments: Array<{ amountMinor: number; status: string }>;
  deliverWebhooks: boolean;
  webhookOverrideStatus?: string;
  expectedFindingClasses: string[];
}

function loadFixture(): { currency: string; scenarios: Scenario[] } {
  const fixturePath = path.join(__dirname, "..", "..", "shared", "fixtures", "demo-scenarios.json");
  return JSON.parse(fs.readFileSync(fixturePath, "utf8"));
}

/** Fakes the provider's independent store for this test, in-memory, implementing the same ProviderAdapter contract the real HTTP adapter does. */
class FakeProviderAdapter implements ProviderAdapter {
  constructor(private readonly payments: ProviderPayment[]) {}

  async listAllPayments(): Promise<ProviderPayment[]> {
    return this.payments;
  }

  async getPayment(id: string): Promise<ProviderPayment | null> {
    return this.payments.find((p) => p.id === id) ?? null;
  }
}

describe("reconciliation integration", () => {
  const prisma = new PrismaClient();
  const { currency, scenarios } = loadFixture();
  const payments: ProviderPayment[] = [];

  beforeAll(async () => {
    await prisma.findingOccurrence.deleteMany();
    await prisma.findingRecord.deleteMany();
    await prisma.reconciliationRun.deleteMany();
    await prisma.webhookEvent.deleteMany();
    await prisma.order.deleteMany();

    let seq = 1;
    for (const scenario of scenarios) {
      const createdAt =
        scenario.order.createdAtOffsetHours !== undefined
          ? new Date(Date.now() + scenario.order.createdAtOffsetHours * 60 * 60 * 1000)
          : new Date();

      await prisma.order.create({
        data: {
          reference: scenario.order.reference,
          currency,
          amountMinor: scenario.order.amountMinor,
          bookingStatus: scenario.order.bookingStatus as BookingStatus,
          createdAt,
        },
      });

      const scenarioPayments: ProviderPayment[] = scenario.payments.map((p) => {
        const id = `pay_test_${String(seq).padStart(4, "0")}`;
        seq += 1;
        return {
          id,
          orderReference: scenario.order.reference,
          amountMinor: p.amountMinor,
          currency,
          status: p.status as ProviderPaymentStatus,
          createdAt: createdAt.toISOString(),
          updatedAt: createdAt.toISOString(),
        };
      });
      payments.push(...scenarioPayments);

      if (scenario.deliverWebhooks && scenarioPayments.length > 0) {
        const last = scenarioPayments[scenarioPayments.length - 1]!;
        const claimedStatus = scenario.webhookOverrideStatus || last.status;
        const type =
          claimedStatus === "refunded" ? "payment.refunded" : claimedStatus === "failed" ? "payment.failed" : "payment.succeeded";
        const body = {
          eventId: `evt_test_${scenario.id}`,
          type,
          paymentId: last.id,
          orderReference: last.orderReference,
          amountMinor: last.amountMinor,
          currency: last.currency,
          status: claimedStatus,
          createdAt: last.createdAt,
        };
        const rawBody = JSON.stringify(body);
        const signature = sign(rawBody, SECRET);
        const outcome = await handleWebhook(prisma, rawBody, signature, SECRET, `req_test_${scenario.id}`);
        expect(outcome.result).toBe("processed");
      }
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("produces exactly the documented findings for every demo scenario", async () => {
    const adapter = new FakeProviderAdapter(payments);
    const result = await runReconciliation({
      prisma,
      adapter,
      windowStart: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      windowEnd: new Date(Date.now() + 60 * 60 * 1000),
      gracePeriodMs: 0,
    });

    expect(result.status).toBe("SUCCESS");

    const actualByOrder = new Map<string, Set<string>>();
    for (const finding of result.findings) {
      if (!finding.orderReference) continue;
      const set = actualByOrder.get(finding.orderReference) ?? new Set<string>();
      set.add(finding.mismatchClass);
      actualByOrder.set(finding.orderReference, set);
    }

    for (const scenario of scenarios) {
      const actual = actualByOrder.get(scenario.order.reference) ?? new Set<string>();
      expect([...actual].sort(), `scenario ${scenario.id}`).toEqual([...scenario.expectedFindingClasses].sort());
    }
  });

  it("rejects a replayed webhook as a harmless duplicate, not a double-write", async () => {
    const scenario = scenarios.find((s) => s.deliverWebhooks)!;
    const payment = payments.find((p) => p.orderReference === scenario.order.reference)!;
    const claimedStatus = scenario.webhookOverrideStatus || payment.status;
    const body = {
      eventId: `evt_test_${scenario.id}`,
      type: claimedStatus === "successful" ? "payment.succeeded" : "payment.failed",
      paymentId: payment.id,
      orderReference: payment.orderReference,
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      status: claimedStatus,
      createdAt: payment.createdAt,
    };
    const rawBody = JSON.stringify(body);
    const signature = sign(rawBody, SECRET);

    const outcome = await handleWebhook(prisma, rawBody, signature, SECRET, "req_replay_test");
    expect(outcome.result).toBe("duplicate");

    const count = await prisma.webhookEvent.count({ where: { eventId: body.eventId } });
    expect(count).toBe(1);
  });

  it("rejects a webhook with an invalid signature", async () => {
    const body = JSON.stringify({
      eventId: "evt_bad_sig",
      type: "payment.succeeded",
      paymentId: "pay_x",
      orderReference: null,
      amountMinor: 100,
      currency,
      status: "successful",
      createdAt: new Date().toISOString(),
    });

    await expect(handleWebhook(prisma, body, "t=1,v1=deadbeef", SECRET, "req_bad_sig")).rejects.toThrow();
  });
});
