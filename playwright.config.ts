import { defineConfig } from "@playwright/test";

/**
 * Runs against an already-running app + mock-provider + Postgres (CI starts
 * them itself, in the same order the integration tests already assume -
 * see .github/workflows/ci.yml's "e2e" job), not Playwright's own
 * webServer: the app needs migrations and a seed step first, which a
 * single webServer command can't sequence cleanly.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
});
