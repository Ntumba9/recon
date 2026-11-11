import fs from "fs";
import path from "path";

export interface DemoScenarioOrder {
  reference: string;
  amountMinor: number;
  bookingStatus: string;
  createdAtOffsetHours?: number;
}

export interface DemoScenarioPayment {
  amountMinor: number;
  status: string;
}

export interface DemoScenario {
  id: string;
  description: string;
  order: DemoScenarioOrder;
  payments: DemoScenarioPayment[];
  deliverWebhooks: boolean;
  webhookOverrideStatus?: string;
  expectedFindingClasses: string[];
}

export interface DemoFixture {
  description: string;
  currency: string;
  scenarios: DemoScenario[];
  truncationDemo: { description: string; expectedRunStatus: string };
}

const FIXTURE_PATH = path.join(process.cwd(), "shared", "fixtures", "demo-scenarios.json");

/**
 * Loads the canonical demo scenarios shared by the seed script, the mock
 * provider, the Python CLI's golden fixtures, and (here) the default
 * reconciliation window - one file backs all of them so they can't drift
 * out of sync with each other.
 */
export function loadDemoFixture(): DemoFixture {
  return JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8")) as DemoFixture;
}
