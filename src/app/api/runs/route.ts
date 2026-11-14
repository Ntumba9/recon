import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getConfig } from "@/lib/config";
import { prisma } from "@/lib/db";
import { newRequestId } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { apiError } from "@/lib/apiError";
import { MAX_BODY_BYTES, hasJsonContentType, isAllowedOrigin, readBodyWithLimit } from "@/lib/httpGuards";
import { MockProviderAdapter } from "@/core/provider-adapter/mockProviderAdapter";
import { computeDefaultWindow } from "@/core/reconciler/defaultWindow";
import { runReconciliation } from "@/core/reconciler/runReconciliation";
import { triggerRunSchema } from "@/core/runs/triggerRunSchema";

/**
 * A run older than this with no finishedAt is treated as abandoned (the
 * process that started it crashed or was restarted) rather than genuinely
 * in progress, so one dead run can't block new runs forever. This is a
 * known limitation, not a guarantee: see README "Honest limits".
 */
const STALE_RUN_THRESHOLD_MS = 5 * 60 * 1000;

/**
 * Same-process fast path against a double-click or rapid repeat submit:
 * refused synchronously, with no database round trip. The actual,
 * cross-process guarantee is a partial unique index on ReconciliationRun
 * (prisma/migrations/20261113090000_run_lock_unique_index) allowing at
 * most one row with finishedAt IS NULL at a time - the database itself
 * rejects a second concurrent run's insert, so this flag is an
 * optimization, not the source of truth.
 */
let runInFlight = false;

/**
 * Triggers one reconciliation run against the mock provider, using the
 * default window (see src/core/reconciler/defaultWindow.ts) unless an
 * explicit window is given. This endpoint has no authentication - same
 * unauthenticated, local-only posture as every other route in this demo
 * (see README "Honest limits") - and it never touches an Order or payment
 * beyond what the reconciler itself already does; it only starts a run.
 *
 * Error shape: every failure is { error, message, requestId } (see
 * src/lib/apiError.ts) - invalid_json/invalid_body (400), run_in_progress
 * (409), payload_too_large (413), unsupported_media_type (415),
 * forbidden_origin (403).
 */
export async function POST(req: NextRequest) {
  const requestId = newRequestId();

  if (!isAllowedOrigin(req)) {
    return apiError("forbidden_origin", "Request Origin does not match this host.", requestId);
  }

  // Checked and set back-to-back, with no `await` in between, so two
  // requests arriving in the same process can't both pass the check before
  // either sets the flag - that gap is exactly what let a fast double-click
  // slip through an earlier version of this guard.
  if (runInFlight) {
    return apiError("run_in_progress", "A reconciliation run is already in progress.", requestId);
  }
  runInFlight = true;

  try {
    const bodyResult = await readBodyWithLimit(req);
    if (!bodyResult.ok) {
      return apiError("payload_too_large", `Request body exceeds ${MAX_BODY_BYTES} bytes.`, requestId);
    }
    const rawBody = bodyResult.raw;

    if (!hasJsonContentType(req, rawBody)) {
      return apiError("unsupported_media_type", "Content-Type must be application/json.", requestId);
    }

    let parsedJson: unknown = {};
    if (rawBody.trim().length > 0) {
      try {
        parsedJson = JSON.parse(rawBody);
      } catch {
        return apiError("invalid_json", "Request body is not valid JSON.", requestId);
      }
    }

    const parsed = triggerRunSchema.safeParse(parsedJson);
    if (!parsed.success) {
      const message = parsed.error.issues.map((i) => i.message).join("; ") || "Invalid request body.";
      return apiError("invalid_body", message, requestId);
    }

    // Reap any stale run (no finishedAt, started before the threshold) so
    // one abandoned run can't block new ones forever. This step doesn't
    // need to be race-free itself - two requests both marking the same
    // stale row finished is just an idempotent update - the actual
    // concurrency guarantee is the unique index hit below.
    const staleCutoff = new Date(Date.now() - STALE_RUN_THRESHOLD_MS);
    const reaped = await prisma.reconciliationRun.updateMany({
      where: { finishedAt: null, startedAt: { lt: staleCutoff } },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        notes: "Run did not finish (process restarted or crashed); marked FAILED after a staleness timeout so new runs are not blocked indefinitely.",
      },
    });
    if (reaped.count > 0) {
      logger.warn("abandoned stale in-progress run(s) before starting a new one", { requestId, count: reaped.count });
    }

    const config = getConfig();
    const { windowStart, windowEnd } = parsed.data.windowStart && parsed.data.windowEnd
      ? { windowStart: parsed.data.windowStart, windowEnd: parsed.data.windowEnd }
      : computeDefaultWindow();

    const adapter = new MockProviderAdapter(config.MOCK_PROVIDER_URL);

    let result;
    try {
      result = await runReconciliation({ prisma, adapter, windowStart, windowEnd });
    } catch (err) {
      // The run's own first write (prisma.reconciliationRun.create, inside
      // runReconciliation) hit the partial unique index because another
      // run was already in progress - the database caught the race the
      // old findFirst-then-create check above used to miss.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        return apiError("run_in_progress", "A reconciliation run is already in progress.", requestId);
      }
      throw err;
    }
    const run = await prisma.reconciliationRun.findUniqueOrThrow({ where: { id: result.runId } });

    return NextResponse.json({
      ok: true,
      runId: result.runId,
      status: result.status,
      findingCount: result.findings.length,
      notes: run.notes,
      windowStart: run.windowStart,
      windowEnd: run.windowEnd,
      requestId,
    });
  } catch (err) {
    logger.error("run trigger failed unexpectedly", { requestId, message: (err as Error).message });
    return apiError("internal_error", "The run could not be completed.", requestId);
  } finally {
    runInFlight = false;
  }
}
