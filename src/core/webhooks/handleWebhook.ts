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
 * for a payment.succeeded event whose own amount and currency match the
 * order it names) confirm the booking, all inside one transaction. A
 * duplicate delivery is harmless: it is detected by the unique eventId
 * constraint and treated as a no-op, not an error. A mismatched amount or
 * currency, or a booking that isn't PENDING/PAYMENT_PENDING (EXPIRED and
 * CANCELLED never change), simply isn't confirmed - the event is still
 * logged. The webhook never changes the provider's own record, and the
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
        // Only the obvious same-direction update: a payment.succeeded claim
        // whose own amount and currency agree with the order it names.
        // A mismatched claim is still logged above as a WebhookEvent, but
        // the order is left alone for the reconciler to flag against the
        // provider's own record directly (AMOUNT_CURRENCY_MISMATCH) -
        // never confirmed on the strength of a webhook's own numbers.
        await tx.order.updateMany({
          where: {
            reference: payload.orderReference,
            bookingStatus: { in: ["PENDING", "PAYMENT_PENDING"] },
            amountMinor: payload.amountMinor,
            currency: payload.currency,
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
