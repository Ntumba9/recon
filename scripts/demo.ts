/**
 * One-command demo: seeds RECON's own order store, seeds the independent
 * mock provider (which pushes webhooks to the app as part of seeding - and
 * deliberately withholds one, for the lost-webhook scenario), runs a
 * reconciliation, and prints expected vs. actual findings so the whole
 * pipeline's behavior is visible from a single command.
 */
import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";
import { seedOrders } from "../prisma/seed";
import { MockProviderAdapter } from "../src/core/provider-adapter/mockProviderAdapter";
import { runReconciliation } from "../src/core/reconciler/runReconciliation";

const MOCK_PROVIDER_URL = process.env.MOCK_PROVIDER_URL || "http://localhost:4000";

interface Scenario {
  id: string;
  description: string;
  order: { reference: string };
  expectedFindingClasses: string[];
}

function loadScenarios(): Scenario[] {
  const fixturePath = path.join(__dirname, "..", "shared", "fixtures", "demo-scenarios.json");
  return JSON.parse(fs.readFileSync(fixturePath, "utf8")).scenarios;
}

async function seedMockProvider(): Promise<void> {
  const res = await fetch(new URL("/dev/seed", MOCK_PROVIDER_URL), { method: "POST" });
  if (!res.ok) {
    throw new Error(`Failed to seed mock provider: HTTP ${res.status}`);
  }
}

async function main() {
  const prisma = new PrismaClient();

  try {
    console.log("== RECON demo ==");
    console.log("1. Seeding orders (RECON's own store)...");
    await seedOrders();

    console.log("2. Seeding the mock provider (independent store, pushes webhooks - one is deliberately lost)...");
    await seedMockProvider();

    console.log("3. Running reconciliation...");
    const adapter = new MockProviderAdapter(MOCK_PROVIDER_URL);
    const windowStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const windowEnd = new Date(Date.now() + 60 * 60 * 1000);

    const result = await runReconciliation({
      prisma,
      adapter,
      windowStart,
      windowEnd,
      gracePeriodMs: 0, // demo data is pre-aged in the fixtures; no need to wait out the real grace period
    });

    console.log(`   Run ${result.runId}: status=${result.status}, findings=${result.findings.length}\n`);

    const scenarios = loadScenarios();
    const actualByOrder = new Map<string, Set<string>>();
    for (const finding of result.findings) {
      if (!finding.orderReference) continue;
      const set = actualByOrder.get(finding.orderReference) ?? new Set<string>();
      set.add(finding.mismatchClass);
      actualByOrder.set(finding.orderReference, set);
    }

    let allMatched = true;
    console.log("Scenario".padEnd(24), "Expected".padEnd(38), "Actual");
    console.log("-".repeat(90));
    for (const scenario of scenarios) {
      const expected = new Set(scenario.expectedFindingClasses);
      const actual = actualByOrder.get(scenario.order.reference) ?? new Set<string>();
      const matches = expected.size === actual.size && [...expected].every((c) => actual.has(c));
      if (!matches) allMatched = false;

      console.log(
        scenario.id.padEnd(24),
        (expected.size ? [...expected].join(",") : "(none)").padEnd(38),
        (actual.size ? [...actual].join(",") : "(none)") + (matches ? "" : "  <-- MISMATCH")
      );
    }

    console.log("-".repeat(90));
    console.log(allMatched ? "All scenarios matched expected findings." : "Some scenarios did NOT match expected findings.");

    if (!allMatched) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
