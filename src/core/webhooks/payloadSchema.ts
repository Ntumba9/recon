import { z } from "zod";

export const webhookPayloadSchema = z.object({
  eventId: z.string().min(1),
  type: z.enum(["payment.succeeded", "payment.failed", "payment.refunded"]),
  paymentId: z.string().min(1),
  orderReference: z.string().min(1).nullable(),
  amountMinor: z.number().int(),
  currency: z.string().min(1),
  status: z.enum(["pending", "successful", "failed", "refunded"]),
  createdAt: z.string().min(1),
});

export type WebhookPayload = z.infer<typeof webhookPayloadSchema>;
