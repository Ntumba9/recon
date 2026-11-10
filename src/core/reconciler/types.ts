import type { ProviderPayment } from "../provider-adapter/types";

export type MismatchClass =
  | "SUCCESSFUL_PAYMENT_NOT_CONFIRMED"
  | "CONFIRMED_WITHOUT_SUCCESSFUL_PAYMENT"
  | "DUPLICATE_SUCCESSFUL_PAYMENT"
  | "AMOUNT_CURRENCY_MISMATCH"
  | "AGED_PENDING_BOOKING"
  | "WEBHOOK_PROVIDER_DISAGREEMENT";

export type Severity = "INFO" | "WARNING" | "CRITICAL";

export interface Finding {
  findingKey: string;
  mismatchClass: MismatchClass;
  severity: Severity;
  orderReference: string | null;
  providerPaymentId: string | null;
  currency: string | null;
  amountMinor: number | null;
  evidence: Record<string, unknown>;
}

export interface OrderRecord {
  reference: string;
  currency: string;
  amountMinor: number;
  bookingStatus: "PENDING" | "PAYMENT_PENDING" | "CONFIRMED" | "EXPIRED" | "CANCELLED";
  createdAt: Date;
}

export interface WebhookEventRecord {
  eventId: string;
  providerPaymentId: string;
  orderReference: string | null;
  type: string;
  signatureValid: boolean;
  receivedAt: Date;
  /** The payment status the webhook claimed, as delivered in its payload. */
  claimedStatus: string;
}

export interface ReconcileContext {
  orders: OrderRecord[];
  payments: ProviderPayment[];
  webhookEvents: WebhookEventRecord[];
  now: Date;
  /** How long a payment or pending booking is given before being flagged, to absorb normal processing lag. */
  gracePeriodMs: number;
}

export type RunStatus = "SUCCESS" | "INCONCLUSIVE" | "FAILED";

export interface ReconcileResult {
  status: RunStatus;
  findings: Finding[];
  notes?: string;
}
