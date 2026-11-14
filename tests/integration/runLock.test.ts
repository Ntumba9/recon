import { PrismaClient, Prisma } from "@prisma/client";
import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as postRuns } from "@/app/api/runs/route";
import { runReconciliation } from "@/core/reconciler/runReconciliation";
import type { ListAllPaymentsResult, ProviderAdapter, ProviderPayment } from "@/core/provider-adapter/types";

const prisma = new PrismaClient();

class EmptyProviderAdapter implements ProviderAdapter {
  async listAllPayments(): Promise<ListAllPaymentsResult> {
    return { payments: [], complete: true };
  }
  async getPayment(): Promise<ProviderPayment | null> {
    return null;
  }
}

/** A provider adapter that stalls, so two reconciliation runs started close together are still both in flight (both past their initial run-row create) when the race matters. */
class SlowProviderAdapter implements ProviderAdapter {
  constructor(private readonly delayMs: number) {}
  async listAllPayments(): Promise<ListAllPaymentsResult> {
    await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    return { payments: [], complete: true };
  }
  async getPayment(): Promise<ProviderPayment | null> {
    return null;
  }
}

describe("run lock: a partial unique index, not a findFirst-then-create race", () => {
  beforeEach(async () => {
    // FindingHistoryEntry references FindingRecord with ON DELETE RESTRICT,
    // so it has to be cleared first.
    await prisma.findingHistoryEntry.deleteMany();
    await prisma.findingOccurrence.deleteMany();
    await prisma.findingRecord.deleteMany();
    await prisma.reconciliationRun.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("the database itself allows only one ReconciliationRun with finishedAt IS NULL at a time", async () => {
    const windowStart = new Date(Date.now() - 60 * 60 * 1000);
    const windowEnd = new Date();

    const attempts = await Promise.allSettled([
      prisma.reconciliationRun.create({ data: { windowStart, windowEnd, status: "FAILED", providerAvailable: true } }),
      prisma.reconciliationRun.create({ data: { windowStart, windowEnd, status: "FAILED", providerAvailable: true } }),
    ]);

    const fulfilled = attempts.filter((a) => a.status === "fulfilled");
    const rejected = attempts.filter((a) => a.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const rejection = rejected[0] as PromiseRejectedResult;
    expect(rejection.reason).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect((rejection.reason as Prisma.PrismaClientKnownRequestError).code).toBe("P2002");

    const inProgressCount = await prisma.reconciliationRun.count({ where: { finishedAt: null } });
    expect(inProgressCount).toBe(1);
  });

  it("two concurrent runReconciliation() calls: exactly one starts, the other fails with the unique-index conflict", async () => {
    const windowStart = new Date(Date.now() - 60 * 60 * 1000);
    const windowEnd = new Date();

    // A slow adapter keeps the first run's row un-finished while the second
    // call's own initial create races against it, so the test isn't
    // sensitive to how fast the mock adapter happens to resolve.
    const results = await Promise.allSettled([
      runReconciliation({ prisma, adapter: new SlowProviderAdapter(200), windowStart, windowEnd }),
      runReconciliation({ prisma, adapter: new EmptyProviderAdapter(), windowStart, windowEnd }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const rejection = rejected[0] as PromiseRejectedResult;
    expect(rejection.reason).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect((rejection.reason as Prisma.PrismaClientKnownRequestError).code).toBe("P2002");
  });

  it("POST /api/runs: two concurrent triggers end with exactly one run started", async () => {
    function triggerRequest() {
      return new NextRequest("http://localhost/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
    }

    const [first, second] = await Promise.all([postRuns(triggerRequest()), postRuns(triggerRequest())]);
    const statuses = [first.status, second.status].sort();
    // Whichever loses the race - caught by the in-process fast path or the
    // database constraint underneath it - is reported as 409, never a
    // silent duplicate run.
    expect(statuses).toEqual([200, 409]);

    const runCount = await prisma.reconciliationRun.count();
    expect(runCount).toBe(1);
  });
});
