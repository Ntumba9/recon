export type ProviderPaymentStatus = "pending" | "successful" | "failed" | "refunded";

export interface ProviderPayment {
  id: string;
  orderReference: string;
  amountMinor: number;
  currency: string;
  status: ProviderPaymentStatus;
  createdAt: string;
  updatedAt: string;
}

export interface DateWindow {
  /** inclusive, UTC */
  from: Date;
  /** exclusive, UTC */
  to: Date;
}

export interface ListAllPaymentsResult {
  payments: ProviderPayment[];
  /**
   * False when the export is known to be partial: pagination stopped before
   * exhausting every page, or the provider's declared total disagreed with
   * the number of records actually returned. A caller must treat an
   * incomplete result as "unknown", never as "no payment found".
   */
  complete: boolean;
  /** Present when complete is false, for logging/evidence. */
  incompleteReason?: string;
}

/**
 * Fetches payment records from the provider. The reconciler talks to the
 * provider only through this interface and never through webhook logs -
 * a webhook is an unverified claim until corroborated here, and provider
 * data that can't be fetched must surface as an error, not as "no payment".
 */
export interface ProviderAdapter {
  /**
   * Fetches every payment in the window, following pagination to
   * completion, and reports whether the result is actually complete. A
   * request-level failure (unreachable, non-2xx) still throws
   * ProviderUnavailableError - this return value is only for a request that
   * succeeded but whose data is self-reportedly partial.
   */
  listAllPayments(window: DateWindow): Promise<ListAllPaymentsResult>;
  getPayment(id: string): Promise<ProviderPayment | null>;
}
