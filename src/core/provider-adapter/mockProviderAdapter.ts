import { ProviderUnavailableError } from "@/lib/errors";
import type { DateWindow, ProviderAdapter, ProviderPayment } from "./types";

interface ListPaymentsResponse {
  data: ProviderPayment[];
  nextCursor: string | null;
  hasMore: boolean;
  total: number;
}

const MAX_PAGES = 1000;

/** Adapter for RECON's mock provider (mock-provider/). A real integration would implement the same ProviderAdapter interface. */
export class MockProviderAdapter implements ProviderAdapter {
  constructor(private readonly baseUrl: string) {}

  async listAllPayments(window: DateWindow): Promise<ProviderPayment[]> {
    const results: ProviderPayment[] = [];
    let cursor: string | undefined;

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const url = new URL("/payments", this.baseUrl);
      url.searchParams.set("from", window.from.toISOString());
      url.searchParams.set("to", window.to.toISOString());
      url.searchParams.set("limit", "100");
      if (cursor) url.searchParams.set("cursor", cursor);

      let response: Response;
      try {
        response = await fetch(url, { method: "GET" });
      } catch (err) {
        throw new ProviderUnavailableError(`Could not reach provider: ${(err as Error).message}`);
      }

      if (!response.ok) {
        throw new ProviderUnavailableError(`Provider returned HTTP ${response.status} listing payments`);
      }

      const body = (await response.json()) as ListPaymentsResponse;
      results.push(...body.data);

      if (!body.hasMore || !body.nextCursor) {
        return results;
      }
      cursor = body.nextCursor;
    }

    throw new ProviderUnavailableError("Provider pagination did not terminate within the page limit");
  }

  async getPayment(id: string): Promise<ProviderPayment | null> {
    const url = new URL(`/payments/${encodeURIComponent(id)}`, this.baseUrl);
    let response: Response;
    try {
      response = await fetch(url, { method: "GET" });
    } catch (err) {
      throw new ProviderUnavailableError(`Could not reach provider: ${(err as Error).message}`);
    }

    if (response.status === 404) return null;
    if (!response.ok) {
      throw new ProviderUnavailableError(`Provider returned HTTP ${response.status} fetching payment ${id}`);
    }
    return (await response.json()) as ProviderPayment;
  }
}
