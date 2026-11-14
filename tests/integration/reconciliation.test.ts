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

async function postStatus(id: string, body: { status: string; note?: string | null }) {
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
    // FindingHistoryEntry references FindingRecord with ON DELETE RESTRICT,
    // so it has to be cleared first - otherwise re-running this suite
    // against a database that already has history fails the FindingRecord
    // delete below.
    await prisma.findingHistoryEntry.deleteMany();
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

    describe("note preservation contract", () => {
      async function findingWithNote(note: string) {
        const scenario = scenarios.find((s) => s.id === "aged_pending")!;
        const record = await prisma.findingRecord.findFirstOrThrow({
          where: { orderReference: scenario.order.reference, mismatchClass: "AGED_PENDING_BOOKING" },
        });
        await prisma.findingRecord.update({ where: { id: record.id }, data: { note } });
        return record.id;
      }

      it("omitting note from the request body preserves the existing note", async () => {
        const id = await findingWithNote("keep me");
        const res = await postStatus(id, { status: "ACKNOWLEDGED" });
        expect(res.status).toBe(200);
        const updated = await prisma.findingRecord.findUniqueOrThrow({ where: { id } });
        expect(updated.note).toBe("keep me");
        expect(updated.status).toBe("ACKNOWLEDGED");
      });

      it("note: null explicitly clears the existing note", async () => {
        const id = await findingWithNote("to be cleared");
        const res = await postStatus(id, { status: "ACKNOWLEDGED", note: null });
        expect(res.status).toBe(200);
        const updated = await prisma.findingRecord.findUniqueOrThrow({ where: { id } });
        expect(updated.note).toBeNull();
      });

      it("note: '' (empty after trimming) explicitly clears the existing note", async () => {
        const id = await findingWithNote("to be cleared too");
        const res = await postStatus(id, { status: "ACKNOWLEDGED", note: "   " });
        expect(res.status).toBe(200);
        const updated = await prisma.findingRecord.findUniqueOrThrow({ where: { id } });
        expect(updated.note).toBeNull();
      });

      it("a non-empty note replaces the existing note", async () => {
        const id = await findingWithNote("old note");
        const res = await postStatus(id, { status: "ACKNOWLEDGED", note: "new note" });
        expect(res.status).toBe(200);
        const updated = await prisma.findingRecord.findUniqueOrThrow({ where: { id } });
        expect(updated.note).toBe("new note");
      });

      it("omitting note on a finding that never had one leaves it null", async () => {
        const scenario = scenarios.find((s) => s.id === "duplicate_payment")!;
        const record = await prisma.findingRecord.findFirstOrThrow({
          where: { orderReference: scenario.order.reference, mismatchClass: "DUPLICATE_SUCCESSFUL_PAYMENT" },
        });
        await prisma.findingRecord.update({ where: { id: record.id }, data: { note: null } });

        const res = await postStatus(record.id, { status: "ACKNOWLEDGED" });
        expect(res.status).toBe(200);
        const updated = await prisma.findingRecord.findUniqueOrThrow({ where: { id: record.id } });
        expect(updated.note).toBeNull();
      });
    });

    describe("finding history", () => {
      async function createTestFinding(overrides: { status?: "OPEN" | "ACKNOWLEDGED" | "RESOLVED"; note?: string | null } = {}) {
        const anyRun = await prisma.reconciliationRun.findFirstOrThrow();
        return prisma.findingRecord.create({
          data: {
            findingKey: `history_test_${Date.now()}_${Math.random().toString(36).slice(2)}`,
            mismatchClass: "AMOUNT_CURRENCY_MISMATCH",
            orderReference: "ord_history_test",
            currency,
            amountMinor: 1000,
            firstSeenRunId: anyRun.id,
            lastSeenRunId: anyRun.id,
            status: overrides.status ?? "OPEN",
            note: overrides.note ?? null,
          },
        });
      }

      function historyFor(findingRecordId: string) {
        return prisma.findingHistoryEntry.findMany({
          where: { findingRecordId },
          orderBy: { sequence: "asc" },
        });
      }

      it("rolls back both the status update and the history entry together if either write fails", async () => {
        const record = await createTestFinding();

        await expect(
          prisma.$transaction(async (tx) => {
            await tx.findingRecord.update({ where: { id: record.id }, data: { status: "ACKNOWLEDGED" } });
            // sourceRunId references a row that does not exist, violating the
            // foreign key and forcing the whole transaction to fail - the
            // same write pattern updateFindingStatus and persistFindings use.
            await tx.findingHistoryEntry.create({
              data: {
                findingRecordId: record.id,
                previousStatus: "OPEN",
                newStatus: "ACKNOWLEDGED",
                changeSource: "MANUAL",
                noteChangeType: "UNCHANGED",
                sourceRunId: "does-not-exist",
              },
            });
          })
        ).rejects.toThrow();

        const afterRollback = await prisma.findingRecord.findUniqueOrThrow({ where: { id: record.id } });
        expect(afterRollback.status).toBe("OPEN");
        expect(await prisma.findingHistoryEntry.count({ where: { findingRecordId: record.id } })).toBe(0);
      });

      it("an identical repeated request does not create a duplicate history entry", async () => {
        const record = await createTestFinding();

        const first = await postStatus(record.id, { status: "ACKNOWLEDGED", note: "investigating" });
        expect(first.status).toBe(200);
        const second = await postStatus(record.id, { status: "ACKNOWLEDGED", note: "investigating" });
        expect(second.status).toBe(200);

        const entries = await historyFor(record.id);
        expect(entries).toHaveLength(1);

        const updated = await prisma.findingRecord.findUniqueOrThrow({ where: { id: record.id } });
        expect(updated.status).toBe("ACKNOWLEDGED");
        expect(updated.note).toBe("investigating");
      });

      it("omitting note on a repeat request is also a no-op, not a duplicate entry", async () => {
        const record = await createTestFinding({ note: "steady" });

        await postStatus(record.id, { status: "ACKNOWLEDGED" });
        await postStatus(record.id, { status: "ACKNOWLEDGED" });

        expect(await historyFor(record.id)).toHaveLength(1);
      });

      it("handles two concurrent requests without a lost update, recording both as a consistent chain", async () => {
        const record = await createTestFinding();

        const [first, second] = await Promise.all([
          postStatus(record.id, { status: "ACKNOWLEDGED" }),
          postStatus(record.id, { status: "RESOLVED" }),
        ]);
        expect([first.status, second.status]).toEqual([200, 200]);

        const final = await prisma.findingRecord.findUniqueOrThrow({ where: { id: record.id } });
        expect(["ACKNOWLEDGED", "RESOLVED"]).toContain(final.status);

        const entries = await historyFor(record.id);
        expect(entries).toHaveLength(2);
        // Whichever request committed first, the second must chain from it -
        // not both claiming OPEN as their previousStatus, which would mean
        // one write silently clobbered the other instead of retrying
        // against the fresh state.
        expect(entries[0]!.previousStatus).toBe("OPEN");
        expect(entries[1]!.previousStatus).toBe(entries[0]!.newStatus);
        expect(entries[1]!.newStatus).toBe(final.status);
      });

      it("records a note-only edit (status unchanged) as its own history entry", async () => {
        const record = await createTestFinding({ status: "ACKNOWLEDGED", note: "old" });

        const res = await postStatus(record.id, { status: "ACKNOWLEDGED", note: "updated" });
        expect(res.status).toBe(200);

        const entries = await historyFor(record.id);
        expect(entries).toHaveLength(1);
        expect(entries[0]!.previousStatus).toBe("ACKNOWLEDGED");
        expect(entries[0]!.newStatus).toBe("ACKNOWLEDGED");
        expect(entries[0]!.noteChangeType).toBe("SET");
        expect(entries[0]!.newNote).toBe("updated");
        expect(entries[0]!.changeSource).toBe("MANUAL");
      });

      it("records note preservation (omitted note) as noteChangeType UNCHANGED", async () => {
        const record = await createTestFinding({ note: "keep me" });

        await postStatus(record.id, { status: "ACKNOWLEDGED" });

        const entries = await historyFor(record.id);
        expect(entries).toHaveLength(1);
        expect(entries[0]!.noteChangeType).toBe("UNCHANGED");
        expect(entries[0]!.newNote).toBeNull();
      });

      it("records an explicit note clear as noteChangeType CLEARED", async () => {
        const record = await createTestFinding({ note: "to clear" });

        await postStatus(record.id, { status: "ACKNOWLEDGED", note: null });

        const entries = await historyFor(record.id);
        expect(entries).toHaveLength(1);
        expect(entries[0]!.noteChangeType).toBe("CLEARED");
        expect(entries[0]!.newNote).toBeNull();
      });

      it("records an automatic reopen with changeSource RECONCILIATION and a sourceRunId", async () => {
        const confirmedNoPayment = scenarios.find((s) => s.id === "confirmed_no_payment")!;
        const record = await prisma.findingRecord.findFirstOrThrow({
          where: { orderReference: confirmedNoPayment.order.reference, mismatchClass: "CONFIRMED_WITHOUT_SUCCESSFUL_PAYMENT" },
        });
        await prisma.findingRecord.update({ where: { id: record.id }, data: { status: "RESOLVED" } });

        const adapter = new FakeProviderAdapter(payments, true);
        const result = await runReconciliation({
          prisma,
          adapter,
          windowStart: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
          windowEnd: new Date(Date.now() + 60 * 60 * 1000),
          gracePeriodMs: 0,
        });

        const entries = await historyFor(record.id);
        // This finding may already have an earlier reopen entry from a prior
        // test in this file, so match this run specifically rather than
        // just the first RECONCILIATION/OPEN entry found.
        const reopenEntry = entries.find((e) => e.changeSource === "RECONCILIATION" && e.sourceRunId === result.runId);
        expect(reopenEntry).toBeDefined();
        expect(reopenEntry!.previousStatus).toBe("RESOLVED");
        expect(reopenEntry!.newStatus).toBe("OPEN");
        expect(reopenEntry!.noteChangeType).toBe("UNCHANGED");
      });

      it("never writes a history entry for a finding left untouched by an INCONCLUSIVE run", async () => {
        const wrongAmount = scenarios.find((s) => s.id === "wrong_amount")!;
        const record = await prisma.findingRecord.findFirstOrThrow({
          where: { orderReference: wrongAmount.order.reference, mismatchClass: "AMOUNT_CURRENCY_MISMATCH" },
        });
        await prisma.findingRecord.update({ where: { id: record.id }, data: { status: "RESOLVED" } });
        const historyBefore = (await historyFor(record.id)).length;

        const adapter = new FakeProviderAdapter(payments, false);
        const result = await runReconciliation({
          prisma,
          adapter,
          windowStart: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
          windowEnd: new Date(Date.now() + 60 * 60 * 1000),
          gracePeriodMs: 0,
        });
        expect(result.status).toBe("INCONCLUSIVE");

        const stillResolved = await prisma.findingRecord.findUniqueOrThrow({ where: { id: record.id } });
        expect(stillResolved.status).toBe("RESOLVED");
        expect(await historyFor(record.id)).toHaveLength(historyBefore);
      });

      it("returns history in deterministic order even when entries share a timestamp", async () => {
        const record = await createTestFinding();

        await postStatus(record.id, { status: "ACKNOWLEDGED" });
        await postStatus(record.id, { status: "RESOLVED" });
        await postStatus(record.id, { status: "OPEN" });

        const entries = await historyFor(record.id);
        expect(entries.map((e) => e.newStatus)).toEqual(["ACKNOWLEDGED", "RESOLVED", "OPEN"]);
        for (let i = 1; i < entries.length; i += 1) {
          expect(entries[i]!.sequence).toBeGreaterThan(entries[i - 1]!.sequence);
        }
      });
    });
  });
});
