import type { FindingStatus, PrismaClient } from "@prisma/client";
import { logger } from "@/lib/logger";
import { isValidTransition } from "./validTransition";

export interface UpdateFindingStatusInput {
  status: FindingStatus;
  /** Whether the request body had a "note" key at all - see the note contract in statusTransitionSchema.ts. */
  noteFieldPresent: boolean;
  note: string | null | undefined;
}

export type UpdateFindingStatusOutcome =
  | { result: "not_found" }
  | { result: "applied"; finding: { id: string; status: FindingStatus; note: string | null } }
  | { result: "invalid_transition"; from: FindingStatus; to: FindingStatus }
  | { result: "conflict" };

const MAX_RETRIES = 3;

function computeNextNote(current: string | null, input: UpdateFindingStatusInput): string | null {
  if (!input.noteFieldPresent) return current;
  if (input.note === null || input.note === "") return null;
  return input.note ?? null;
}

/**
 * Applies a manual status/note change to a finding, writing the
 * FindingRecord update and its FindingHistoryEntry in one transaction -
 * either both commit or neither does.
 *
 * Concurrency approach: each attempt is conditioned on the row's `version`
 * as read at the start of that attempt (optimistic concurrency; see
 * FindingRecord.version in prisma/schema.prisma). If another writer - a
 * concurrent manual request, or a reconciliation run reopening the same
 * finding - commits first, the conditioned update affects zero rows; this
 * function re-reads the now-current row and retries, reapplying this same
 * request's intent against the fresh state (never blindly overwriting with
 * data read before the other writer committed), up to MAX_RETRIES times.
 *
 * Before every attempt, if applying the request would be a true no-op
 * against the row as currently read (identical resulting status and note),
 * nothing is written and no history entry is created. This is what keeps
 * an identical retried request - whether a literal network retry of the
 * same call, or a second attempt that lost the race above and finds the
 * winner already did the same thing - from producing a duplicate entry.
 *
 * Limits: this protects one FindingRecord row's writes against each other.
 * It is not a distributed lock and gives no cross-table serializability.
 * Sustained contention that exhausts MAX_RETRIES surfaces as a conflict
 * for the caller to retry; this function does not retry forever.
 *
 * The requested status is validated against the row's state as read at
 * the start of each attempt (see validTransition.ts), not just once
 * up front - a transition legal against the state the caller saw could
 * become illegal against what another writer just committed, and the
 * reverse. A status-unchanged (note-only) request is always a valid
 * "transition" to itself.
 */
export async function updateFindingStatus(
  prisma: PrismaClient,
  id: string,
  input: UpdateFindingStatusInput
): Promise<UpdateFindingStatusOutcome> {
  const initial = await prisma.findingRecord.findUnique({ where: { id } });
  if (!initial) return { result: "not_found" };

  let current = initial;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const row = current;
    const nextStatus = input.status;

    if (!isValidTransition(row.status, nextStatus)) {
      return { result: "invalid_transition", from: row.status, to: nextStatus };
    }

    const nextNote = computeNextNote(row.note, input);

    const statusChanged = nextStatus !== row.status;
    const noteChanged = nextNote !== row.note;

    if (!statusChanged && !noteChanged) {
      return { result: "applied", finding: { id: row.id, status: row.status, note: row.note } };
    }

    const noteChangeType = !input.noteFieldPresent || !noteChanged ? "UNCHANGED" : nextNote === null ? "CLEARED" : "SET";

    const applied = await prisma.$transaction(async (tx) => {
      const writeResult = await tx.findingRecord.updateMany({
        where: { id, version: row.version },
        data: {
          status: nextStatus,
          note: nextNote,
          ...(statusChanged ? { statusChangedAt: new Date() } : {}),
          version: { increment: 1 },
        },
      });
      if (writeResult.count === 0) return null;

      await tx.findingHistoryEntry.create({
        data: {
          findingRecordId: id,
          previousStatus: row.status,
          newStatus: nextStatus,
          changeSource: "MANUAL",
          noteChangeType,
          newNote: noteChangeType === "SET" ? nextNote : null,
        },
      });

      return { id, status: nextStatus, note: nextNote };
    });

    if (applied) {
      return { result: "applied", finding: applied };
    }

    logger.warn("finding status update lost a concurrency race, retrying against fresh state", { findingId: id, attempt });
    current = await prisma.findingRecord.findUniqueOrThrow({ where: { id } });
  }

  return { result: "conflict" };
}
