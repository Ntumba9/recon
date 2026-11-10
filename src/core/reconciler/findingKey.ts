import crypto from "crypto";
import type { MismatchClass } from "./types";

/**
 * Deterministic identity for a finding, built only from the natural keys
 * that define the discrepancy (never from a run ID or timestamp), so the
 * same underlying issue produces the same key on every rerun.
 */
export function buildFindingKey(mismatchClass: MismatchClass, ...parts: Array<string | null | undefined>): string {
  const material = [mismatchClass, ...parts.map((p) => p ?? "")].join("|");
  return crypto.createHash("sha256").update(material).digest("hex").slice(0, 32);
}
