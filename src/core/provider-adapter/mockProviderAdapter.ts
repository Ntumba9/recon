import { ProviderUnavailableError } from "@/lib/errors";
import type { DateWindow, ListAllPaymentsResult, ProviderAdapter, ProviderPayment } from "./types";

interface ListPaymentsResponse {
  data: ProviderPayment[];
  nextCursor: string | null;
  hasMore: boolean;
  total: number;
}

const MAX_PAGES = 1000;
const REQUIRED_PAYMENT_FIELDS: ReadonlyArray<keyof ProviderPayment> = [
  "id",
  "orderReference",
  "amountMinor",
  "currency",
  "status",
  "createdAt",
  "updatedAt",
];

function isWellFormedPage(body: unknown): body is ListPaymentsResponse {
  if (typeof body !== "object" || body === null) return false;
  const candidate = body as Partial<ListPaymentsResponse>;
  if (!Array.isArray(candidate.data)) return false;
  if (typeof candidate.total !== "number" || typeof candidate.hasMore !== "boolean") return false;
  return candidate.data.every(
    (record) => typeof record === "object" && record !== null && REQUIRED_PAYMENT_FIELDS.every((field) => field in record)
  );
}

/** Adapter for RECON's mock provider (mock-provider/). A real integration would implement the same ProviderAdapter interface. */
export class MockProviderAdapter implements ProviderAdapter {
  constructor(private readonly baseUrl: string) {}

  async listAllPayments(window: DateWindow): Promise<ListAllPaymentsResult> {
    const results: ProviderPayment[] = [];
    let cursor: string | undefined;
    let declaredTotal: number | undefined;

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

      let rawBody: unknown;
      try {
        rawBody = await response.json();
      } catch {
        return { payments: results, complete: false, incompleteReason: "Provider response was not valid JSON" };
      }

      if (!isWellFormedPage(rawBody)) {
        return {
          payments: results,
          complete: false,
          incompleteReason: "Provider page was malformed (missing or invalid fields)",
        };
      }

      // The declared total should hold steady across every page of one
      // listing; if it changes mid-pagination the export can't be trusted.
      if (declaredTotal !== undefined && rawBody.total !== declaredTotal) {
        return {
          payments: results,
          complete: false,
          incompleteReason: `Provider's declared total changed mid-pagination (${declaredTotal} -> ${rawBody.total})`,
        };
      }
      declaredTotal = rawBody.total;
      results.push(...rawBody.data);

      if (!rawBody.hasMore || !rawBody.nextCursor) {
        if (declaredTotal !== results.length) {
          return {
            payments: results,
            complete: false,
            incompleteReason: `Provider declared ${declaredTotal} payment(s) but only ${results.length} were returned`,
          };
        }
        return { payments: results, complete: true };
      }
      cursor = rawBody.nextCursor;
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
