import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { WebhookVerificationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { webhookPayloadSchema } from "./payloadSchema";
import { verifyWebhookSignature } from "./verifySignature";

export type WebhookOutcome =
  | { result: "processed"; eventId: string }
  | { result: "duplicate"; eventId: string }
  | { result: "rejected"; reason: string };

const UNIQUE_CONSTRAINT_VIOLATION = "P2002";

/**
 * Webhook intake: validate payload shape, verify the raw-body HMAC signature
 * with a constant-time comparison, then durably dedup by eventId and (only
 * for a successfully-verified payment.succeeded event) confirm the booking,
 * all inside one transaction. A duplicate delivery is harmless: it is
 * detected by the unique eventId constraint and treated as a no-op, not an
 * error. The webhook never changes the provider's own record, and the
 * reconciler re-derives truth from the provider directly rather than
 * trusting this log - see src/core/reconciler.
 */
export async function handleWebhook(
  prisma: PrismaClient,
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
  requestId: string
): Promise<WebhookOutcome> {
  const verification = verifyWebhookSignature(rawBody, signatureHeader, secret);
  if (!verification.valid) {
    logger.warn("webhook rejected: signature verification failed", { requestId, reason: verification.reason });
    throw new WebhookVerificationError(verification.reason ?? "invalid_signature", requestId);
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawBody);
  } catch {
    return { result: "rejected", reason: "invalid_json" };
  }

  const parsed = webhookPayloadSchema.safeParse(parsedJson);
  if (!parsed.success) {
    logger.warn("webhook rejected: payload failed validation", { requestId, issues: parsed.error.issues });
    return { result: "rejected", reason: "invalid_payload" };
  }

  const payload = parsed.data;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.webhookEvent.create({
        data: {
          eventId: payload.eventId,
          providerPaymentId: payload.paymentId,
          orderReference: payload.orderReference,
          type: payload.type,
          signatureValid: true,
          payload: payload as unknown as Prisma.InputJsonValue,
        },
      });

      if (payload.type === "payment.succeeded" && payload.orderReference) {
        await tx.order.updateMany({
          where: {
            reference: payload.orderReference,
            bookingStatus: { in: ["PENDING", "PAYMENT_PENDING"] },
          },
          data: { bookingStatus: "CONFIRMED" },
        });
      }
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === UNIQUE_CONSTRAINT_VIOLATION) {
      logger.info("webhook duplicate: eventId already processed", { requestId, eventId: payload.eventId });
      return { result: "duplicate", eventId: payload.eventId };
    }
    throw err;
  }

  logger.info("webhook processed", { requestId, eventId: payload.eventId, type: payload.type });
  return { result: "processed", eventId: payload.eventId };
}
