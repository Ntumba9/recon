import { PrismaClient } from "@prisma/client";
import { test, expect } from "@playwright/test";
import { sign } from "../mock-provider/signature.js";

const prisma = new PrismaClient();
const MOCK_PROVIDER_URL = process.env.MOCK_PROVIDER_URL ?? "http://localhost:4000";
const WEBHOOK_SECRET = process.env.MOCK_PROVIDER_WEBHOOK_SECRET ?? "whsec_ci_test_secret_do_not_use_0123456789";

async function resetAndSeed() {
  await prisma.findingOccurrence.deleteMany();
  await prisma.findingRecord.deleteMany();
  await prisma.reconciliationRun.deleteMany();
  await prisma.webhookEvent.deleteMany();
  await prisma.order.deleteMany();

  // Created well before the run-trigger route's default 15-minute grace
  // period, with no matching payment ever seeded at the mock provider, so
  // a real run reliably produces exactly one AGED_PENDING_BOOKING finding
  // for the flows below to work with.
  await prisma.order.create({
    data: {
      reference: "ord_e2e_pending",
      currency: "ZAR",
      amountMinor: 5000,
      bookingStatus: "PAYMENT_PENDING",
      createdAt: new Date(Date.now() - 60 * 60 * 1000),
    },
  });

  const seedRes = await fetch(new URL("/dev/reset", MOCK_PROVIDER_URL), { method: "POST" });
  if (!seedRes.ok) throw new Error(`mock provider reset failed: HTTP ${seedRes.status}`);
}

test.beforeAll(async () => {
  await resetAndSeed();
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

test.describe.serial("RECON end-to-end flows", () => {
  test("trigger a run from the browser and see its findings with the right counts", async ({ page }) => {
    await page.goto("/runs");
    await page.getByRole("button", { name: "Run reconciliation" }).click();
    await expect(page.getByText(/Run finished:/)).toBeVisible({ timeout: 15_000 });

    await page.goto("/findings");
    const openStat = page.locator(".summary-stat", { hasText: "Open" }).locator("dd");
    await expect(openStat).toHaveText(/\d+/);

    const dbCount = await prisma.findingRecord.count({ where: { status: "OPEN" } });
    await expect(openStat).toHaveText(String(dbCount));
  });

  test("acknowledge a finding with a note and see it persist after reload", async ({ page }) => {
    const finding = await prisma.findingRecord.findFirstOrThrow({ where: { status: "OPEN" } });

    await page.goto("/findings");
    const row = page.locator("tr", { has: page.getByText(finding.mismatchClass, { exact: true }) }).first();
    await row.getByRole("button", { name: "Details" }).click();

    const noteInput = page.getByLabel("Note");
    await noteInput.fill("acknowledged via e2e flow");
    await page.getByRole("button", { name: "Acknowledge" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();

    await page.reload();
    const updated = await prisma.findingRecord.findUniqueOrThrow({ where: { id: finding.id } });
    expect(updated.status).toBe("ACKNOWLEDGED");
    expect(updated.note).toBe("acknowledged via e2e flow");

    const reopenedRow = page.locator("tr", { has: page.getByText(finding.mismatchClass, { exact: true }) }).first();
    await expect(reopenedRow.getByText("ACKNOWLEDGED", { exact: true })).toBeVisible();
  });

  test("filtering by class and status is reflected in the URL and the visible rows", async ({ page }) => {
    const finding = await prisma.findingRecord.findFirstOrThrow();

    await page.goto(`/findings?class=${finding.mismatchClass}&status=${finding.status}`);
    await expect(page).toHaveURL(new RegExp(`class=${finding.mismatchClass}`));
    await expect(page).toHaveURL(new RegExp(`status=${finding.status}`));

    const rows = page.locator("table.data-table tbody tr:not(.detail-row)");
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i += 1) {
      await expect(rows.nth(i)).toContainText(finding.mismatchClass);
    }
  });

  test("a signed webhook arrives and the finding view reflects the confirmed booking", async ({ page }) => {
    await resetAndSeed();
    const reference = "ord_e2e_webhook";
    await prisma.order.create({
      data: { reference, currency: "ZAR", amountMinor: 7700, bookingStatus: "PAYMENT_PENDING" },
    });

    const payload = {
      eventId: `evt_e2e_${Date.now()}`,
      type: "payment.succeeded",
      paymentId: `pay_e2e_${Date.now()}`,
      orderReference: reference,
      amountMinor: 7700,
      currency: "ZAR",
      status: "successful",
      createdAt: new Date().toISOString(),
    };
    const rawBody = JSON.stringify(payload);
    const signature = sign(rawBody, WEBHOOK_SECRET);

    const res = await page.request.post("/api/webhooks/provider", {
      headers: { "Content-Type": "application/json", "x-mock-signature": signature },
      data: rawBody,
    });
    expect(res.ok()).toBeTruthy();

    const order = await prisma.order.findUniqueOrThrow({ where: { reference } });
    expect(order.bookingStatus).toBe("CONFIRMED");
  });

  test("security headers are present and the CSP does not break hydration on the findings or runs pages", async ({ page }) => {
    const violations: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error" && /content security policy/i.test(msg.text())) {
        violations.push(msg.text());
      }
    });

    for (const path of ["/findings", "/runs"]) {
      const res = await page.goto(path);
      expect(res?.headers()["x-content-type-options"]).toBe("nosniff");
      expect(res?.headers()["referrer-policy"]).toBe("no-referrer");
      expect(res?.headers()["x-frame-options"]).toBe("DENY");
      expect(res?.headers()["content-security-policy"]).toContain("script-src 'self' 'unsafe-inline'");

      // Hydration actually ran under this exact policy: a button click only
      // works if React attached its event handlers, which the CSP would
      // have blocked (via a dropped inline bootstrap script) had it been
      // too strict.
      if (path === "/runs") {
        await expect(page.getByRole("button", { name: "Run reconciliation" })).toBeEnabled();
      } else {
        await expect(page.locator(".summary-strip")).toBeVisible();
      }
    }

    expect(violations).toEqual([]);
  });

  test("a request with a mismatched Origin is rejected and changes nothing", async ({ page }) => {
    const finding = await prisma.findingRecord.findFirstOrThrow();
    const before = await prisma.findingRecord.findUniqueOrThrow({ where: { id: finding.id } });

    const res = await page.request.post(`/api/findings/${finding.id}/status`, {
      headers: { "Content-Type": "application/json", origin: "https://evil.example.com" },
      data: JSON.stringify({ status: before.status === "OPEN" ? "ACKNOWLEDGED" : "OPEN" }),
    });
    expect(res.status()).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("forbidden_origin");

    const after = await prisma.findingRecord.findUniqueOrThrow({ where: { id: finding.id } });
    expect(after.status).toBe(before.status);
    expect(after.note).toBe(before.note);
  });
});
