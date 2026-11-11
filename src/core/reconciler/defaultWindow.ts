import { loadDemoFixture } from "@/lib/demoFixture";

/** Safety margin added beyond the oldest scenario's offset, to absorb clock skew and give demo data room without needing a hand-tuned constant. */
const SAFETY_MARGIN_MS = 24 * 60 * 60 * 1000;
/** How far past "now" the window extends, to tolerate a record created moments before the run starts. */
const LOOKAHEAD_MS = 60 * 60 * 1000;

export interface ReconciliationWindow {
  windowStart: Date;
  windowEnd: Date;
}

/**
 * The default reconciliation window's lookback is derived from the oldest
 * `createdAtOffsetHours` across the shared demo scenarios (shared/fixtures/
 * demo-scenarios.json) - not an arbitrary constant - plus a fixed safety
 * margin. Both the demo script and the browser-triggered "Run
 * reconciliation" action use this same function, so the two can never
 * disagree about what "the default window" means.
 *
 * Only orders needing a matching provider payment inside the window
 * actually depend on this (orders themselves are never window-filtered),
 * so this is already a generous bound for the shipped fixtures.
 */
export function computeDefaultWindow(now: Date = new Date()): ReconciliationWindow {
  const fixture = loadDemoFixture();
  const oldestOffsetHours = fixture.scenarios.reduce(
    (min, scenario) => Math.min(min, scenario.order.createdAtOffsetHours ?? 0),
    0
  );
  const lookbackMs = Math.abs(oldestOffsetHours) * 60 * 60 * 1000 + SAFETY_MARGIN_MS;

  return {
    windowStart: new Date(now.getTime() - lookbackMs),
    windowEnd: new Date(now.getTime() + LOOKAHEAD_MS),
  };
}
