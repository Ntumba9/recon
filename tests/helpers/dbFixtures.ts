import type { FindingStatus, PrismaClient } from "@prisma/client";

/** Creates a minimal finished ReconciliationRun, for tests that just need a valid run id to satisfy a foreign key. */
export async function createTestRun(prisma: PrismaClient) {
  return prisma.reconciliationRun.create({
    data: {
      windowStart: new Date(Date.now() - 60 * 60 * 1000),
      windowEnd: new Date(),
      status: "SUCCESS",
      finishedAt: new Date(),
    },
  });
}

/** Creates a standalone FindingRecord for tests that exercise the status endpoint directly, without running the full reconciler. */
export async function createTestFinding(
  prisma: PrismaClient,
  overrides: { status?: FindingStatus; note?: string | null; orderReference?: string } = {}
) {
  const run = await createTestRun(prisma);
  return prisma.findingRecord.create({
    data: {
      findingKey: `test_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      mismatchClass: "AMOUNT_CURRENCY_MISMATCH",
      orderReference: overrides.orderReference ?? "ord_api_test",
      currency: "ZAR",
      amountMinor: 1000,
      firstSeenRunId: run.id,
      lastSeenRunId: run.id,
      status: overrides.status ?? "OPEN",
      note: overrides.note ?? null,
    },
  });
}
