import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { sign } from "../../mock-provider/signature.js";
import { handleWebhook } from "@/core/webhooks/handleWebhook";

const SECRET = "whsec_webhook_confirm_test_secret_0123456789";
const prisma = new PrismaClient();

let seq = 1;
function uniqueRef(prefix: string) {
  seq += 1;
  return `${prefix}_${Date.now()}_${seq}`;
}

async function createOrder(bookingStatus: "PENDING" | "PAYMENT_PENDING" | "CONFIRMED" | "EXPIRED" | "CANCELLED", amountMinor = 10000, currency = "ZAR") {
  return prisma.order.create({
    data: { reference: uniqueRef("ord"), currency, amountMinor, bookingStatus },
  });
}

async function deliverWebhook(opts: {
  orderReference: string;
  amountMinor: number;
  currency: string;
  status?: "successful" | "failed" | "refunded";
  eventId?: string;
}) {
  const body = {
    eventId: opts.eventId ?? uniqueRef("evt"),
    type: "payment.succeeded" as const,
    paymentId: uniqueRef("pay"),
    orderReference: opts.orderReference,
    amountMinor: opts.amountMinor,
    currency: opts.currency,
    status: opts.status ?? "successful",
    createdAt: new Date().toISOString(),
  };
  const rawBody = JSON.stringify(body);
  const signature = sign(rawBody, SECRET);
  return { outcome: await handleWebhook(prisma, rawBody, signature, SECRET, "req_webhook_confirm_test"), body };
}

describe("webhook confirmation only on an amount/currency match", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("confirms the order when the webhook's amount and currency match it", async () => {
    const order = await createOrder("PENDING", 10000, "ZAR");
    const { outcome } = await deliverWebhook({ orderReference: order.reference, amountMinor: 10000, currency: "ZAR" });
    expect(outcome.result).toBe("processed");

    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.bookingStatus).toBe("CONFIRMED");
  });

  it("does not confirm the order when the webhook's amount disagrees, but still logs the event", async () => {
    const order = await createOrder("PENDING", 10000, "ZAR");
    const { outcome, body } = await deliverWebhook({ orderReference: order.reference, amountMinor: 9500, currency: "ZAR" });
    expect(outcome.result).toBe("processed");

    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.bookingStatus).toBe("PENDING");

    const event = await prisma.webhookEvent.findUnique({ where: { eventId: body.eventId } });
    expect(event).not.toBeNull();
  });

  it("does not confirm the order when the webhook's currency disagrees", async () => {
    const order = await createOrder("PAYMENT_PENDING", 10000, "ZAR");
    const { outcome } = await deliverWebhook({ orderReference: order.reference, amountMinor: 10000, currency: "USD" });
    expect(outcome.result).toBe("processed");

    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.bookingStatus).toBe("PAYMENT_PENDING");
  });

  it("a replayed webhook is a no-op: the order's state does not change again", async () => {
    const order = await createOrder("PENDING", 10000, "ZAR");
    const eventId = uniqueRef("evt");
    const first = await deliverWebhook({ orderReference: order.reference, amountMinor: 10000, currency: "ZAR", eventId });
    expect(first.outcome.result).toBe("processed");

    const afterFirst = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(afterFirst.bookingStatus).toBe("CONFIRMED");

    const replay = await deliverWebhook({ orderReference: order.reference, amountMinor: 10000, currency: "ZAR", eventId });
    expect(replay.outcome.result).toBe("duplicate");

    const afterReplay = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(afterReplay.bookingStatus).toBe("CONFIRMED");
    expect(afterReplay.updatedAt.getTime()).toBe(afterFirst.updatedAt.getTime());

    const eventCount = await prisma.webhookEvent.count({ where: { eventId } });
    expect(eventCount).toBe(1);
  });

  it("never confirms an EXPIRED order, even with a matching amount and currency", async () => {
    const order = await createOrder("EXPIRED", 10000, "ZAR");
    await deliverWebhook({ orderReference: order.reference, amountMinor: 10000, currency: "ZAR" });

    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.bookingStatus).toBe("EXPIRED");
  });

  it("never confirms a CANCELLED order, even with a matching amount and currency", async () => {
    const order = await createOrder("CANCELLED", 10000, "ZAR");
    await deliverWebhook({ orderReference: order.reference, amountMinor: 10000, currency: "ZAR" });

    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.bookingStatus).toBe("CANCELLED");
  });
});
