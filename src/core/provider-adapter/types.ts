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

/**
 * Fetches payment records from the provider. The reconciler talks to the
 * provider only through this interface and never through webhook logs -
 * a webhook is an unverified claim until corroborated here, and provider
 * data that can't be fetched must surface as an error, not as "no payment".
 */
export interface ProviderAdapter {
  /** Fetches every payment in the window, following pagination to completion. */
  listAllPayments(window: DateWindow): Promise<ProviderPayment[]>;
  getPayment(id: string): Promise<ProviderPayment | null>;
}
