export type FindingStatusValue = "OPEN" | "ACKNOWLEDGED" | "RESOLVED";

/** The lifecycle a human can drive through the status endpoint - the same shape the findings page's action buttons already expose (src/app/findings/FindingActions.tsx). */
const ALLOWED_NEXT_STATUSES: Record<FindingStatusValue, readonly FindingStatusValue[]> = {
  OPEN: ["ACKNOWLEDGED", "RESOLVED"],
  ACKNOWLEDGED: ["RESOLVED", "OPEN"],
  RESOLVED: ["OPEN"],
};

/**
 * A request is a valid transition when it either leaves status exactly as
 * it is (a note-only edit) or moves to one of the next statuses the UI
 * exposes for the current one. Anything else - skipping a step, or an
 * otherwise-unreachable jump - is rejected so the API can't be driven into
 * a state the UI never allows a human to reach.
 */
export function isValidTransition(current: FindingStatusValue, next: FindingStatusValue): boolean {
  if (current === next) return true;
  return ALLOWED_NEXT_STATUSES[current].includes(next);
}
