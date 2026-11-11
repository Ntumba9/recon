const STALE_RUN_THRESHOLD_MS = 5 * 60 * 1000;

/** A run with no finishedAt younger than the staleness threshold is genuinely in progress - see src/app/api/runs/route.ts for the matching server-side guard. */
export function isRunInProgress(startedAt: Date, finishedAt: Date | null, now: Date = new Date()): boolean {
  return finishedAt === null && now.getTime() - startedAt.getTime() < STALE_RUN_THRESHOLD_MS;
}
