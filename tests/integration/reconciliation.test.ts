import fs from "fs";
import path from "path";
import { PrismaClient, type BookingStatus } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sign } from "../../mock-provider/signature.js";
import { handleWebhook } from "@/core/webhooks/handleWebhook";
import { runReconciliation } from "@/core/reconciler/runReconciliation";
import type { ListAllPaymentsResult, ProviderAdapter, ProviderPayment, ProviderPaymentStatus } from "@/core/provider-adapter/types";
import { POST as postFindingStatus } from "@/app/api/findings/[id]/status/route";
import { NextRequest } from "next/server";

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
  constructor(private readonly payments: ProviderPayment[], private readonly complete: boolean = true) {}

  async listAllPayments(): Promise<ListAllPaymentsResult> {
    return { payments: this.payments, complete: this.complete, incompleteReason: this.complete ? undefined : "simulated incomplete export" };
  }

  async getPayment(id: string): Promise<ProviderPayment | null> {
    return this.payments.find((p) => p.id === id) ?? null;
  }
}

async function postStatus(id: string, body: { status: string; note?: string }) {
  const request = new NextRequest("http://localhost/api/findings/" + id + "/status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return postFindingStatus(request, { params: Promise.resolve({ id }) });
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

  describe("finding lifecycle", () => {
    it("transitions OPEN -> ACKNOWLEDGED -> RESOLVED with a note, and never touches the order", async () => {
      const confirmedNoPayment = scenarios.find((s) => s.id === "confirmed_no_payment")!;
      const record = await prisma.findingRecord.findFirstOrThrow({
        where: { orderReference: confirmedNoPayment.order.reference, mismatchClass: "CONFIRMED_WITHOUT_SUCCESSFUL_PAYMENT" },
      });
      const orderBefore = await prisma.order.findUniqueOrThrow({ where: { reference: confirmedNoPayment.order.reference } });

      const ackRes = await postStatus(record.id, { status: "ACKNOWLEDGED", note: "investigating" });
      expect(ackRes.status).toBe(200);
      let updated = await prisma.findingRecord.findUniqueOrThrow({ where: { id: record.id } });
      expect(updated.status).toBe("ACKNOWLEDGED");
      expect(updated.note).toBe("investigating");
      expect(updated.statusChangedAt).not.toBeNull();

      const resolveRes = await postStatus(record.id, { status: "RESOLVED", note: "confirmed manually offline" });
      expect(resolveRes.status).toBe(200);
      updated = await prisma.findingRecord.findUniqueOrThrow({ where: { id: record.id } });
      expect(updated.status).toBe("RESOLVED");
      expect(updated.note).toBe("confirmed manually offline");

      const orderAfter = await prisma.order.findUniqueOrThrow({ where: { reference: confirmedNoPayment.order.reference } });
      expect(orderAfter).toEqual(orderBefore);
    });

    it("rejects an invalid status value", async () => {
      const record = await prisma.findingRecord.findFirstOrThrow();
      const res = await postStatus(record.id, { status: "CLOSED" });
      expect(res.status).toBe(400);
    });

    it("returns 404 for an unknown finding id", async () => {
      const res = await postStatus("not-a-real-id", { status: "ACKNOWLEDGED" });
      expect(res.status).toBe(404);
    });

    it("reopens a RESOLVED finding when its discrepancy recurs in a later complete run", async () => {
      const confirmedNoPayment = scenarios.find((s) => s.id === "confirmed_no_payment")!;
      const record = await prisma.findingRecord.findFirstOrThrow({
        where: { orderReference: confirmedNoPayment.order.reference, mismatchClass: "CONFIRMED_WITHOUT_SUCCESSFUL_PAYMENT" },
      });

      // Resolved by the previous test in this describe block; reconfirm here so this test is self-sufficient.
      await prisma.findingRecord.update({ where: { id: record.id }, data: { status: "RESOLVED", statusChangedAt: new Date() } });

      const adapter = new FakeProviderAdapter(payments, true);
      await runReconciliation({
        prisma,
        adapter,
        windowStart: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        windowEnd: new Date(Date.now() + 60 * 60 * 1000),
        gracePeriodMs: 0,
      });

      const reopened = await prisma.findingRecord.findUniqueOrThrow({ where: { id: record.id } });
      expect(reopened.status).toBe("OPEN");
    });

    it("does not reopen a RESOLVED finding from an incomplete run, even one that still recurs in the output", async () => {
      // AMOUNT_CURRENCY_MISMATCH is presence-based, so it still appears when
      // the export is incomplete - this specifically exercises the
      // allowStatusTransitions gate, not the rule-level absence suppression.
      const wrongAmount = scenarios.find((s) => s.id === "wrong_amount")!;
      const record = await prisma.findingRecord.findFirstOrThrow({
        where: { orderReference: wrongAmount.order.reference, mismatchClass: "AMOUNT_CURRENCY_MISMATCH" },
      });
      await prisma.findingRecord.update({ where: { id: record.id }, data: { status: "RESOLVED", statusChangedAt: new Date() } });

      const adapter = new FakeProviderAdapter(payments, false);
      const result = await runReconciliation({
        prisma,
        adapter,
        windowStart: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        windowEnd: new Date(Date.now() + 60 * 60 * 1000),
        gracePeriodMs: 0,
      });

      expect(result.status).toBe("INCONCLUSIVE");
      expect(result.findings.map((f) => f.mismatchClass)).toContain("AMOUNT_CURRENCY_MISMATCH");

      const stillResolved = await prisma.findingRecord.findUniqueOrThrow({ where: { id: record.id } });
      expect(stillResolved.status).toBe("RESOLVED");
    });
  });
});
