/**
 * Regenerates shared/fixtures/golden-findings.json from the actual
 * TypeScript reconciler (src/core/reconciler), run against a deterministic
 * build of the shared demo scenarios (see tests/helpers/goldenFixtureBuilder.ts).
 *
 * This file is checked in and used by two independent tests:
 *  - tests/unit/goldenFindings.test.ts (this engine must still match it)
 *  - python-cli/tests/test_parity.py (the Python CLI must match it too)
 * so the two implementations are compared against one frozen source of
 * truth rather than against each other directly. Run this script again only
 * when the demo scenarios or a rule's intended behavior genuinely changes -
 * both parity tests will fail loudly if the engine's output and this file
 * ever disagree unexpectedly.
 */
import fs from "fs";
import path from "path";
import { reconcile } from "../src/core/reconciler";
import { buildGoldenContext, normalizeFindings } from "../tests/helpers/goldenFixtureBuilder";

function main() {
  const complete = reconcile(buildGoldenContext(true));
  const incomplete = reconcile(buildGoldenContext(false));

  const golden = {
    description:
      "Golden reconciliation output for the shared demo scenarios, generated from the TypeScript engine against a fixed, deterministic input (see tests/helpers/goldenFixtureBuilder.ts). Checked by tests/unit/goldenFindings.test.ts (TypeScript) and python-cli/tests/test_parity.py (Python) so both implementations are verified against the same frozen output. Regenerate with: npx tsx scripts/generate-golden-findings.ts",
    complete: { status: complete.status, findings: normalizeFindings(complete.findings) },
    incomplete: { status: incomplete.status, findings: normalizeFindings(incomplete.findings) },
  };

  const outPath = path.join(__dirname, "..", "shared", "fixtures", "golden-findings.json");
  fs.writeFileSync(outPath, JSON.stringify(golden, null, 2) + "\n");
  console.log(`Wrote ${outPath}`);
  console.log(`  complete: status=${complete.status}, findings=${complete.findings.length}`);
  console.log(`  incomplete: status=${incomplete.status}, findings=${incomplete.findings.length}`);
}

main();
