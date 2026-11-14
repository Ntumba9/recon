import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { logger } from "@/lib/logger";
import { ProviderUnavailableError } from "@/lib/errors";
import type { ProviderAdapter } from "../provider-adapter/types";
import { reconcile } from "./index";
import type { Finding, OrderRecord, ReconcileContext, WebhookEventRecord } from "./types";

export interface RunReconciliationOptions {
  prisma: PrismaClient;
  adapter: ProviderAdapter;
  windowStart: Date;
  windowEnd: Date;
  now?: Date;
  gracePeriodMs?: number;
}

export interface RunReconciliationResult {
  runId: string;
  status: "SUCCESS" | "INCONCLUSIVE" | "FAILED";
  findings: Finding[];
  notes?: string;
}

const DEFAULT_GRACE_PERIOD_MS = 15 * 60 * 1000; // 15 minutes

async function loadOrders(prisma: PrismaClient): Promise<OrderRecord[]> {
  const rows = await prisma.order.findMany();
  return rows.map((o) => ({
    reference: o.reference,
    currency: o.currency,
    amountMinor: o.amountMinor,
    bookingStatus: o.bookingStatus,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  }));
}

async function loadWebhookEvents(prisma: PrismaClient): Promise<WebhookEventRecord[]> {
  const rows = await prisma.webhookEvent.findMany();
  return rows.map((e) => {
    const payload = e.payload as { status?: string } | null;
    return {
      eventId: e.eventId,
      providerPaymentId: e.providerPaymentId,
      orderReference: e.orderReference,
      type: e.type,
      signatureValid: e.signatureValid,
      receivedAt: e.receivedAt,
      claimedStatus: payload?.status ?? "unknown",
    };
  });
}

/**
 * Orchestrates one reconciliation run: fetch the provider's records for the
 * window (never trusting the webhook log instead), compare against orders,
 * and persist a run plus its findings. If the provider can't be reached or
 * returns partial/invalid data, the run is marked FAILED and no findings
 * are produced - an unreachable provider must never be read as "no payment
 * found".
 */
export async function runReconciliation(opts: RunReconciliationOptions): Promise<RunReconciliationResult> {
  const { prisma, adapter, windowStart, windowEnd } = opts;
  const now = opts.now ?? new Date();
  const gracePeriodMs = opts.gracePeriodMs ?? DEFAULT_GRACE_PERIOD_MS;

  const run = await prisma.reconciliationRun.create({
    data: {
      windowStart,
      windowEnd,
      status: "FAILED", // placeholder until we know the outcome; updated below
      providerAvailable: true,
    },
  });

  let listResult;
  try {
    listResult = await adapter.listAllPayments({ from: windowStart, to: windowEnd });
  } catch (err) {
    const message = err instanceof ProviderUnavailableError ? err.message : `Unexpected error: ${(err as Error).message}`;
    logger.error("reconciliation run failed: provider unavailable", { runId: run.id, message });
    await prisma.reconciliationRun.update({
      where: { id: run.id },
      data: { status: "FAILED", providerAvailable: false, finishedAt: new Date(), notes: message },
    });
    return { runId: run.id, status: "FAILED", findings: [], notes: message };
  }

  const { payments, complete, incompleteReason } = listResult;
  const [orders, webhookEvents] = await Promise.all([loadOrders(prisma), loadWebhookEvents(prisma)]);

  const ctx: ReconcileContext = { orders, payments, webhookEvents, now, gracePeriodMs, complete };
  const result = reconcile(ctx);

  await persistFindings(prisma, run.id, result.findings, result.status === "SUCCESS");

  await prisma.reconciliationRun.update({
    where: { id: run.id },
    data: { status: result.status, finishedAt: new Date(), notes: incompleteReason ?? result.notes },
  });

  logger.info("reconciliation run completed", { runId: run.id, findingCount: result.findings.length });

  return { runId: run.id, status: result.status, findings: result.findings };
}

const MAX_PERSIST_RETRIES = 3;

/**
 * Upserts each finding's stable FindingRecord and records this run's
 * evidence as a FindingOccurrence, inside one transaction per finding so a
 * partial write never leaves a record without its occurrence.
 *
 * When `allowStatusTransitions` is true (a SUCCESS run only - never an
 * INCONCLUSIVE or FAILED one), a RESOLVED finding whose discrepancy recurs
 * is reopened automatically, and that reopen is recorded as a
 * FindingHistoryEntry referencing this run (changeSource RECONCILIATION).
 * An incomplete run still records the occurrence for whatever
 * presence-based findings it did produce, but must never touch a
 * FindingRecord's lifecycle status or write a history entry.
 *
 * Concurrency: an existing record's update is conditioned on the
 * `version` read moments earlier in the same attempt (the same
 * optimistic-concurrency token the manual status endpoint uses - see
 * src/core/findings/updateFindingStatus.ts). If a manual edit commits in
 * between - most importantly, one that moves the finding off RESOLVED
 * before this reopen would apply - the conditioned write affects zero
 * rows; this re-reads the now-current record and retries, so a reopen is
 * never forced onto a finding a human has just moved on from. Up to
 * MAX_PERSIST_RETRIES per finding; exhausting that logs and skips this
 * finding for this run rather than looping forever under contention.
 */
async function persistFindings(
  prisma: PrismaClient,
  runId: string,
  findings: Finding[],
  allowStatusTransitions: boolean
): Promise<void> {
  for (const finding of findings) {
    await persistOneFinding(prisma, runId, finding, allowStatusTransitions);
  }
}

async function persistOneFinding(
  prisma: PrismaClient,
  runId: string,
  finding: Finding,
  allowStatusTransitions: boolean
): Promise<void> {
  for (let attempt = 0; attempt < MAX_PERSIST_RETRIES; attempt++) {
    const applied = await prisma.$transaction(async (tx) => {
      const existing = await tx.findingRecord.findUnique({ where: { findingKey: finding.findingKey } });

      if (!existing) {
        const record = await tx.findingRecord.create({
          data: {
            findingKey: finding.findingKey,
            mismatchClass: finding.mismatchClass,
            orderReference: finding.orderReference,
            providerPaymentId: finding.providerPaymentId,
            currency: finding.currency,
            amountMinor: finding.amountMinor,
            firstSeenRunId: runId,
            lastSeenRunId: runId,
          },
        });
        await upsertOccurrence(tx, record.id, runId, finding);
        return true;
      }

      const shouldReopen = allowStatusTransitions && existing.status === "RESOLVED";

      const writeResult = await tx.findingRecord.updateMany({
        where: { id: existing.id, version: existing.version },
        data: {
          lastSeenRunId: runId,
          currency: finding.currency,
          amountMinor: finding.amountMinor,
          version: { increment: 1 },
          ...(shouldReopen ? { status: "OPEN" as const, statusChangedAt: new Date() } : {}),
        },
      });
      if (writeResult.count === 0) return false;

      if (shouldReopen) {
        logger.info("finding reopened: resolved discrepancy recurred", { runId, findingKey: finding.findingKey });
        await tx.findingHistoryEntry.create({
          data: {
            findingRecordId: existing.id,
            previousStatus: "RESOLVED",
            newStatus: "OPEN",
            changeSource: "RECONCILIATION",
            noteChangeType: "UNCHANGED",
            sourceRunId: runId,
          },
        });
      }

      await upsertOccurrence(tx, existing.id, runId, finding);
      return true;
    });

    if (applied) return;
    logger.warn("finding persist lost a concurrency race, retrying against fresh state", {
      runId,
      findingKey: finding.findingKey,
      attempt,
    });
  }

  logger.error("finding persist exhausted retries under contention, skipping for this run", {
    runId,
    findingKey: finding.findingKey,
  });
}

async function upsertOccurrence(
  tx: Prisma.TransactionClient,
  findingRecordId: string,
  runId: string,
  finding: Finding
): Promise<void> {
  await tx.findingOccurrence.upsert({
    where: { findingRecordId_runId: { findingRecordId, runId } },
    create: {
      findingRecordId,
      runId,
      severity: finding.severity,
      evidence: finding.evidence as unknown as Prisma.InputJsonValue,
    },
    update: {
      severity: finding.severity,
      evidence: finding.evidence as unknown as Prisma.InputJsonValue,
    },
  });
}
