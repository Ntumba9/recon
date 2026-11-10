import http from "http";
import type { AddressInfo } from "net";
import { afterEach, describe, expect, it } from "vitest";
import { MockProviderAdapter } from "@/core/provider-adapter/mockProviderAdapter";
import { ProviderUnavailableError } from "@/lib/errors";

let server: http.Server | undefined;

function serve(handler: http.RequestListener): Promise<string> {
  server = http.createServer(handler);
  return new Promise((resolve) => {
    server!.listen(0, "127.0.0.1", () => {
      const { port } = server!.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

afterEach(async () => {
  if (!server) return;
  await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
});

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

const WINDOW = { from: new Date("2026-01-01T00:00:00.000Z"), to: new Date("2026-01-02T00:00:00.000Z") };
const SAMPLE_PAYMENT = {
  id: "pay_1",
  orderReference: "ord_1",
  amountMinor: 100,
  currency: "ZAR",
  status: "successful",
  createdAt: "2026-01-01T01:00:00.000Z",
  updatedAt: "2026-01-01T01:00:00.000Z",
};

describe("MockProviderAdapter.listAllPayments", () => {
  it("reports complete when the declared total matches what was fetched", async () => {
    const baseUrl = await serve((_req, res) => json(res, 200, { data: [SAMPLE_PAYMENT], hasMore: false, nextCursor: null, total: 1 }));
    const result = await new MockProviderAdapter(baseUrl).listAllPayments(WINDOW);
    expect(result.complete).toBe(true);
    expect(result.payments).toEqual([SAMPLE_PAYMENT]);
  });

  it("reports incomplete when the declared total exceeds what was actually returned", async () => {
    const baseUrl = await serve((_req, res) => json(res, 200, { data: [SAMPLE_PAYMENT], hasMore: false, nextCursor: null, total: 2 }));
    const result = await new MockProviderAdapter(baseUrl).listAllPayments(WINDOW);
    expect(result.complete).toBe(false);
    expect(result.incompleteReason).toMatch(/declared 2/);
    expect(result.payments).toEqual([SAMPLE_PAYMENT]);
  });

  it("reports incomplete when a page is malformed", async () => {
    const baseUrl = await serve((_req, res) => json(res, 200, { data: [{ id: "pay_1" }], hasMore: false, nextCursor: null, total: 1 }));
    const result = await new MockProviderAdapter(baseUrl).listAllPayments(WINDOW);
    expect(result.complete).toBe(false);
    expect(result.incompleteReason).toMatch(/malformed/);
  });

  it("reports incomplete when the response is not valid JSON", async () => {
    const baseUrl = await serve((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("not json");
    });
    const result = await new MockProviderAdapter(baseUrl).listAllPayments(WINDOW);
    expect(result.complete).toBe(false);
    expect(result.incompleteReason).toMatch(/not valid JSON/);
  });

  it("throws ProviderUnavailableError (a distinct failure) on a non-2xx response, not an incomplete result", async () => {
    const baseUrl = await serve((_req, res) => json(res, 500, { error: "boom" }));
    await expect(new MockProviderAdapter(baseUrl).listAllPayments(WINDOW)).rejects.toThrow(ProviderUnavailableError);
  });

  it("throws ProviderUnavailableError when the provider cannot be reached at all", async () => {
    // Nothing is listening on this port.
    await expect(new MockProviderAdapter("http://127.0.0.1:1").listAllPayments(WINDOW)).rejects.toThrow(
      ProviderUnavailableError
    );
  });

  it("follows pagination across multiple complete pages", async () => {
    let calls = 0;
    const baseUrl = await serve((_req, res) => {
      calls += 1;
      if (calls === 1) {
        json(res, 200, { data: [SAMPLE_PAYMENT], hasMore: true, nextCursor: "pay_1", total: 2 });
      } else {
        json(res, 200, { data: [{ ...SAMPLE_PAYMENT, id: "pay_2" }], hasMore: false, nextCursor: null, total: 2 });
      }
    });
    const result = await new MockProviderAdapter(baseUrl).listAllPayments(WINDOW);
    expect(result.complete).toBe(true);
    expect(result.payments.map((p) => p.id)).toEqual(["pay_1", "pay_2"]);
  });
});
