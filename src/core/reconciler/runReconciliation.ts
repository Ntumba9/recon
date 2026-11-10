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

  let payments;
  try {
    payments = await adapter.listAllPayments({ from: windowStart, to: windowEnd });
  } catch (err) {
    const message = err instanceof ProviderUnavailableError ? err.message : `Unexpected error: ${(err as Error).message}`;
    logger.error("reconciliation run failed: provider unavailable", { runId: run.id, message });
    await prisma.reconciliationRun.update({
      where: { id: run.id },
      data: { status: "FAILED", providerAvailable: false, finishedAt: new Date(), notes: message },
    });
    return { runId: run.id, status: "FAILED", findings: [], notes: message };
  }

  const [orders, webhookEvents] = await Promise.all([loadOrders(prisma), loadWebhookEvents(prisma)]);

  const ctx: ReconcileContext = { orders, payments, webhookEvents, now, gracePeriodMs };
  const result = reconcile(ctx);

  await persistFindings(prisma, run.id, result.findings);

  await prisma.reconciliationRun.update({
    where: { id: run.id },
    data: { status: result.status, finishedAt: new Date() },
  });

  logger.info("reconciliation run completed", { runId: run.id, findingCount: result.findings.length });

  return { runId: run.id, status: result.status, findings: result.findings };
}

/**
 * Upserts each finding's stable FindingRecord and records this run's
 * evidence as a FindingOccurrence, inside one transaction per finding so a
 * partial write never leaves a record without its occurrence.
 */
async function persistFindings(prisma: PrismaClient, runId: string, findings: Finding[]): Promise<void> {
  for (const finding of findings) {
    await prisma.$transaction(async (tx) => {
      const record = await tx.findingRecord.upsert({
        where: { findingKey: finding.findingKey },
        create: {
          findingKey: finding.findingKey,
          mismatchClass: finding.mismatchClass,
          orderReference: finding.orderReference,
          providerPaymentId: finding.providerPaymentId,
          currency: finding.currency,
          amountMinor: finding.amountMinor,
          firstSeenRunId: runId,
          lastSeenRunId: runId,
        },
        update: {
          lastSeenRunId: runId,
          currency: finding.currency,
          amountMinor: finding.amountMinor,
        },
      });

      await tx.findingOccurrence.upsert({
        where: { findingRecordId_runId: { findingRecordId: record.id, runId } },
        create: {
          findingRecordId: record.id,
          runId,
          severity: finding.severity,
          evidence: finding.evidence as unknown as Prisma.InputJsonValue,
        },
        update: {
          severity: finding.severity,
          evidence: finding.evidence as unknown as Prisma.InputJsonValue,
        },
      });
    });
  }
}
