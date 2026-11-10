import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface ScenarioOrder {
  reference: string;
  amountMinor: number;
  bookingStatus: "PENDING" | "PAYMENT_PENDING" | "CONFIRMED" | "EXPIRED" | "CANCELLED";
  createdAtOffsetHours?: number;
}

interface Scenario {
  id: string;
  description: string;
  order: ScenarioOrder;
}

interface DemoFixture {
  currency: string;
  scenarios: Scenario[];
}

function loadFixture(): DemoFixture {
  const fixturePath = path.join(__dirname, "..", "shared", "fixtures", "demo-scenarios.json");
  return JSON.parse(fs.readFileSync(fixturePath, "utf8"));
}

function offsetDate(hours: number | undefined): Date {
  if (hours === undefined) return new Date();
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

/** Seeds RECON's own order store. The mock provider is seeded independently, through its own HTTP API - see scripts/demo.ts - never from this same code path, so the two stores stay decoupled. */
export async function seedOrders(): Promise<void> {
  const fixture = loadFixture();

  await prisma.findingOccurrence.deleteMany();
  await prisma.findingRecord.deleteMany();
  await prisma.reconciliationRun.deleteMany();
  await prisma.webhookEvent.deleteMany();
  await prisma.order.deleteMany();

  for (const scenario of fixture.scenarios) {
    await prisma.order.create({
      data: {
        reference: scenario.order.reference,
        currency: fixture.currency,
        amountMinor: scenario.order.amountMinor,
        bookingStatus: scenario.order.bookingStatus,
        createdAt: offsetDate(scenario.order.createdAtOffsetHours),
      },
    });
  }

  console.log(`Seeded ${fixture.scenarios.length} orders from demo-scenarios.json`);
}

if (require.main === module) {
  seedOrders()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
