import { describe, expect, it } from "vitest";
import { formatEvidence } from "@/app/findings/formatEvidence";

describe("formatEvidence", () => {
  it("title-cases camelCase keys", () => {
    const fields = formatEvidence({ orderBookingStatus: "CONFIRMED" });
    expect(fields).toEqual([{ key: "orderBookingStatus", label: "Order Booking Status", value: "CONFIRMED" }]);
  });

  it("formats a *Minor amount as major units", () => {
    const fields = formatEvidence({ paymentAmountMinor: 9500 });
    expect(fields[0]!.value).toBe("95.00");
  });

  it("formats a *Ms duration as a short human-readable span", () => {
    const fields = formatEvidence({ ageMs: 2 * 60 * 60 * 1000 + 15 * 60 * 1000 });
    expect(fields[0]!.value).toBe("2h 15m");
  });

  it("formats a *At timestamp string as an ISO date", () => {
    const fields = formatEvidence({ orderCreatedAt: "2026-01-01T00:00:00.000Z" });
    expect(fields[0]!.value).toBe("2026-01-01T00:00:00.000Z");
  });

  it("formats booleans as Yes/No, not raw true/false", () => {
    const fields = formatEvidence({ amountMismatch: true, currencyMismatch: false });
    expect(fields[0]!.value).toBe("Yes");
    expect(fields[1]!.value).toBe("No");
  });

  it("formats an array as a comma-separated list", () => {
    const fields = formatEvidence({ paymentIds: ["pay_1", "pay_2"] });
    expect(fields[0]!.value).toBe("pay_1, pay_2");
  });

  it("formats null as a dash", () => {
    const fields = formatEvidence({ matchingPaymentsFound: null });
    expect(fields[0]!.value).toBe("-");
  });
});
