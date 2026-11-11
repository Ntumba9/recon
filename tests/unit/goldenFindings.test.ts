import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { reconcile } from "@/core/reconciler";
import { buildGoldenContext, normalizeFindings } from "../helpers/goldenFixtureBuilder";

const GOLDEN_PATH = path.join(__dirname, "..", "..", "shared", "fixtures", "golden-findings.json");

/**
 * Guards shared/fixtures/golden-findings.json against silent drift: this
 * engine's output for the deterministic fixture build must keep matching
 * the checked-in golden file exactly (including findingKey, so the hash
 * function itself is covered), the same file the Python CLI's parity test
 * (python-cli/tests/test_parity.py) is checked against. If this test fails
 * after an intentional rule change, regenerate with
 * `npx tsx scripts/generate-golden-findings.ts` and re-run both suites.
 */
describe("golden findings parity fixture", () => {
  const golden = JSON.parse(fs.readFileSync(GOLDEN_PATH, "utf8"));

  it("matches the checked-in golden fixture for a complete export", () => {
    const result = reconcile(buildGoldenContext(true));
    expect(result.status).toBe("SUCCESS");
    expect(normalizeFindings(result.findings)).toEqual(golden.complete.findings);
  });

  it("matches the checked-in golden fixture for an incomplete export", () => {
    const result = reconcile(buildGoldenContext(false));
    expect(result.status).toBe("INCONCLUSIVE");
    expect(normalizeFindings(result.findings)).toEqual(golden.incomplete.findings);
  });
});
