import { describe, expect, it } from "vitest";
import { reconcile } from "@/core/reconciler";
import type { OrderRecord, ReconcileContext, WebhookEventRecord } from "@/core/reconciler/types";
import type { ProviderPayment } from "@/core/provider-adapter/types";

const NOW = new Date("2026-06-01T12:00:00.000Z");

function order(overrides: Partial<OrderRecord>): OrderRecord {
  return {
    reference: "ord_1",
    currency: "ZAR",
    amountMinor: 10000,
    bookingStatus: "PENDING",
    createdAt: new Date("2026-05-01T00:00:00.000Z"),
    ...overrides,
  };
}

function payment(overrides: Partial<ProviderPayment>): ProviderPayment {
  return {
    id: "pay_1",
    orderReference: "ord_1",
    amountMinor: 10000,
    currency: "ZAR",
    status: "successful",
    createdAt: "2026-05-01T00:05:00.000Z",
    updatedAt: "2026-05-01T00:05:00.000Z",
    ...overrides,
  };
}

function baseCtx(overrides: Partial<ReconcileContext>): ReconcileContext {
  return { orders: [], payments: [], webhookEvents: [], now: NOW, gracePeriodMs: 0, ...overrides };
}

describe("reconcile", () => {
  it("reports nothing for a clean, confirmed, successfully-paid order", () => {
    const result = reconcile(
      baseCtx({ orders: [order({ bookingStatus: "CONFIRMED" })], payments: [payment({})] })
    );
    expect(result.findings).toHaveLength(0);
  });

  it("flags a successful payment whose booking is not confirmed", () => {
    const result = reconcile(
      baseCtx({ orders: [order({ bookingStatus: "PAYMENT_PENDING" })], payments: [payment({})] })
    );
    expect(result.findings.map((f) => f.mismatchClass)).toEqual(["SUCCESSFUL_PAYMENT_NOT_CONFIRMED"]);
  });

  it("flags a confirmed booking with no successful payment", () => {
    const result = reconcile(baseCtx({ orders: [order({ bookingStatus: "CONFIRMED" })], payments: [] }));
    expect(result.findings.map((f) => f.mismatchClass)).toEqual(["CONFIRMED_WITHOUT_SUCCESSFUL_PAYMENT"]);
  });

  it("flags duplicate successful payments for the same order", () => {
    const result = reconcile(
      baseCtx({
        orders: [order({ bookingStatus: "CONFIRMED" })],
        payments: [payment({ id: "pay_1" }), payment({ id: "pay_2" })],
      })
    );
    expect(result.findings.map((f) => f.mismatchClass)).toEqual(["DUPLICATE_SUCCESSFUL_PAYMENT"]);
    expect(result.findings[0]?.evidence).toMatchObject({ count: 2 });
  });

  it("flags an amount mismatch between order and payment", () => {
    const result = reconcile(
      baseCtx({
        orders: [order({ bookingStatus: "CONFIRMED", amountMinor: 10000 })],
        payments: [payment({ amountMinor: 9500 })],
      })
    );
    expect(result.findings.map((f) => f.mismatchClass)).toEqual(["AMOUNT_CURRENCY_MISMATCH"]);
  });

  it("flags a currency mismatch between order and payment", () => {
    const result = reconcile(
      baseCtx({
        orders: [order({ bookingStatus: "CONFIRMED", currency: "ZAR" })],
        payments: [payment({ currency: "USD" })],
      })
    );
    expect(result.findings.map((f) => f.mismatchClass)).toEqual(["AMOUNT_CURRENCY_MISMATCH"]);
  });

  it("flags an aged pending booking with no provider payment", () => {
    const result = reconcile(
      baseCtx({
        orders: [order({ bookingStatus: "PAYMENT_PENDING", createdAt: new Date("2026-05-01T00:00:00.000Z") })],
        payments: [],
        gracePeriodMs: 60 * 60 * 1000,
      })
    );
    expect(result.findings.map((f) => f.mismatchClass)).toEqual(["AGED_PENDING_BOOKING"]);
  });

  it("does not flag a pending booking still inside the grace period", () => {
    const result = reconcile(
      baseCtx({
        orders: [order({ bookingStatus: "PAYMENT_PENDING", createdAt: new Date(NOW.getTime() - 1000) })],
        payments: [],
        gracePeriodMs: 60 * 60 * 1000,
      })
    );
    expect(result.findings).toHaveLength(0);
  });

  it("treats a refund as resolved, not as missing money", () => {
    const result = reconcile(
      baseCtx({
        orders: [order({ bookingStatus: "CANCELLED" })],
        payments: [payment({ status: "refunded" })],
      })
    );
    expect(result.findings).toHaveLength(0);
  });

  it("never treats a pending payment as successful", () => {
    const result = reconcile(
      baseCtx({
        orders: [order({ bookingStatus: "PAYMENT_PENDING" })],
        payments: [payment({ status: "pending" })],
      })
    );
    expect(result.findings).toHaveLength(0);
  });

  it("flags disagreement between a webhook's claimed status and the provider's current record", () => {
    const webhookEvents: WebhookEventRecord[] = [
      {
        eventId: "evt_1",
        providerPaymentId: "pay_1",
        orderReference: "ord_1",
        type: "payment.succeeded",
        signatureValid: true,
        receivedAt: new Date("2026-05-01T00:06:00.000Z"),
        claimedStatus: "successful",
      },
    ];
    const result = reconcile(
      baseCtx({
        orders: [order({ bookingStatus: "CONFIRMED" })],
        payments: [payment({ status: "failed" })],
        webhookEvents,
      })
    );
    expect(result.findings.map((f) => f.mismatchClass)).toContain("WEBHOOK_PROVIDER_DISAGREEMENT");
  });

  it("produces a stable findingKey across two runs of the same discrepancy", () => {
    const ctx = baseCtx({ orders: [order({ bookingStatus: "CONFIRMED" })], payments: [] });
    const first = reconcile(ctx).findings[0]?.findingKey;
    const second = reconcile(ctx).findings[0]?.findingKey;
    expect(first).toBeDefined();
    expect(first).toBe(second);
  });
});
