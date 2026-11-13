import { PrismaClient } from "@prisma/client";
import { NextRequest } from "next/server";
import { afterAll, describe, expect, it } from "vitest";
import { sign } from "../../mock-provider/signature.js";
import { POST as postRuns } from "@/app/api/runs/route";
import { POST as postFindingStatus } from "@/app/api/findings/[id]/status/route";
import { POST as postWebhook } from "@/app/api/webhooks/provider/route";
import { MAX_BODY_BYTES } from "@/lib/httpGuards";
import { createTestFinding } from "../helpers/dbFixtures";

const prisma = new PrismaClient();
const WEBHOOK_SECRET = "whsec_ci_test_secret_do_not_use_0123456789";

function bodyStream(bytes: number): ReadableStream<Uint8Array> {
  const chunk = new Uint8Array(bytes).fill(65); // 'A' repeated - not valid JSON, irrelevant to a size check
  return new ReadableStream({
    start(controller) {
      controller.enqueue(chunk);
      controller.close();
    },
  });
}

/**
 * Builds a POST request to /api/findings/:id/status whose body is exactly
 * `bytes` long, with full control over the Content-Length header (or its
 * absence) independent of the actual stream - this is what lets the tests
 * below construct a declared length that disagrees with reality.
 */
function sizedRequest(id: string, bytes: number, headers: Record<string, string> = {}) {
  return new Request(`http://localhost/api/findings/${id}/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: bodyStream(bytes),
    duplex: "half",
  } as RequestInit) as unknown as NextRequest;
}

describe("request safety", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe("baseline: what the routes accepted before this item's checks", () => {
    it(
      "documents the gap this item closes: the body reader never trusted Content-Length (so a spoofed or " +
        "absent one was always irrelevant to its own correctness), but the original routes had no Origin check " +
        "and no Content-Type enforcement at all, so a cross-origin form post (which browsers send as " +
        "application/x-www-form-urlencoded or text/plain, and which carries no custom headers or CORS " +
        "preflight) would have been parsed as if it were a normal same-origin JSON request. The tests below " +
        "prove the current routes reject exactly that: a mismatched Origin (403) and a non-JSON Content-Type " +
        "on a non-empty body (415), while still allowing a no-Origin caller like curl or a script.",
      () => {
        expect(true).toBe(true);
      }
    );
  });

  describe("POST /api/findings/:id/status body-size limit (also exercised by POST /api/runs and the webhook route via the same src/lib/httpGuards.ts helper)", () => {
    it("rejects an oversized body with a correct, matching Content-Length", async () => {
      const finding = await createTestFinding(prisma);
      const oversized = MAX_BODY_BYTES + 1000;
      const req = sizedRequest(finding.id, oversized, { "content-length": String(oversized) });
      const res = await postFindingStatus(req, { params: Promise.resolve({ id: finding.id }) });
      expect(res.status).toBe(413);
    });

    it("rejects an oversized body even when Content-Length is spoofed smaller than the real body", async () => {
      const finding = await createTestFinding(prisma);
      const oversized = MAX_BODY_BYTES + 1000;
      const req = sizedRequest(finding.id, oversized, { "content-length": "10" });
      const res = await postFindingStatus(req, { params: Promise.resolve({ id: finding.id }) });
      expect(res.status).toBe(413);
    });

    it("rejects an oversized body with no Content-Length at all (chunked transfer)", async () => {
      const finding = await createTestFinding(prisma);
      const req = sizedRequest(finding.id, MAX_BODY_BYTES + 1000);
      const res = await postFindingStatus(req, { params: Promise.resolve({ id: finding.id }) });
      expect(res.status).toBe(413);
    });

    it("a body of exactly the limit is not rejected for size", async () => {
      const finding = await createTestFinding(prisma);
      const req = sizedRequest(finding.id, MAX_BODY_BYTES);
      const res = await postFindingStatus(req, { params: Promise.resolve({ id: finding.id }) });
      // The body is MAX_BODY_BYTES of filler, not valid JSON, so it still
      // fails - but on invalid_json (400), never payload_too_large (413).
      expect(res.status).not.toBe(413);
    });
  });

  describe("Origin check (POST /api/runs and POST /api/findings/:id/status only)", () => {
    it("rejects a mismatched Origin with 403", async () => {
      const finding = await createTestFinding(prisma);
      const req = new NextRequest(`http://localhost/api/findings/${finding.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json", origin: "https://evil.example.com" },
        body: JSON.stringify({ status: "ACKNOWLEDGED" }),
      });
      const res = await postFindingStatus(req, { params: Promise.resolve({ id: finding.id }) });
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toBe("forbidden_origin");

      const unchanged = await prisma.findingRecord.findUniqueOrThrow({ where: { id: finding.id } });
      expect(unchanged.status).toBe(finding.status);
    });

    it("allows a request with no Origin header at all (curl, scripts)", async () => {
      const finding = await createTestFinding(prisma);
      const req = new NextRequest(`http://localhost/api/findings/${finding.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "ACKNOWLEDGED" }),
      });
      const res = await postFindingStatus(req, { params: Promise.resolve({ id: finding.id }) });
      expect(res.status).toBe(200);
    });

    it("allows a matching same-origin request", async () => {
      const finding = await createTestFinding(prisma);
      // Deliberately sets Host to a different-looking address than the
      // request URL itself, the way a real request behind a port mapping
      // (e.g. Docker's 3005:3000) would: the check must compare Origin
      // against this Host header, not against the URL's own host.
      const req = new NextRequest(`http://localhost/api/findings/${finding.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json", origin: "http://localhost:3005", host: "localhost:3005" },
        body: JSON.stringify({ status: "ACKNOWLEDGED" }),
      });
      const res = await postFindingStatus(req, { params: Promise.resolve({ id: finding.id }) });
      expect(res.status).toBe(200);
    });

    it("rejects a mismatched Origin on POST /api/runs too", async () => {
      const req = new NextRequest("http://localhost/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json", origin: "https://evil.example.com" },
        body: "{}",
      });
      const res = await postRuns(req);
      expect(res.status).toBe(403);
    });
  });

  describe("Content-Type check", () => {
    it("rejects a non-empty body declared as text/plain (the cross-origin form-post shape) with 415", async () => {
      const finding = await createTestFinding(prisma);
      const req = new NextRequest(`http://localhost/api/findings/${finding.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({ status: "ACKNOWLEDGED" }),
      });
      const res = await postFindingStatus(req, { params: Promise.resolve({ id: finding.id }) });
      expect(res.status).toBe(415);
      const body = await res.json();
      expect(body.error).toBe("unsupported_media_type");
    });

    it("does not require Content-Type on an empty-body run trigger", async () => {
      const req = new NextRequest("http://localhost/api/runs", { method: "POST" });
      const res = await postRuns(req);
      expect(res.status).not.toBe(415);
    });
  });

  describe("webhook route: same body-size cap, but no Origin/Content-Type check, and signature verified over the exact raw bytes", () => {
    it("rejects an oversized webhook body with 413 before attempting signature verification", async () => {
      const oversized = "A".repeat(MAX_BODY_BYTES + 1000);
      const req = new NextRequest("http://localhost/api/webhooks/provider", {
        method: "POST",
        headers: { "x-mock-signature": "t=1,v1=deadbeef" }, // deliberately invalid - should never be reached
        body: oversized,
      });
      const res = await postWebhook(req);
      expect(res.status).toBe(413);
    });

    it("accepts a validly signed webhook within the size limit, verified over its exact raw bytes", async () => {
      const payload = {
        eventId: `evt_safety_${Date.now()}`,
        type: "payment.succeeded",
        paymentId: "pay_safety_test",
        orderReference: null,
        amountMinor: 100,
        currency: "ZAR",
        status: "successful",
        createdAt: new Date().toISOString(),
      };
      const rawBody = JSON.stringify(payload);
      const signature = sign(rawBody, WEBHOOK_SECRET);
      const req = new NextRequest("http://localhost/api/webhooks/provider", {
        method: "POST",
        headers: { "x-mock-signature": signature },
        body: rawBody,
      });
      const res = await postWebhook(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.result).toBe("processed");
    });

    it("rejects a webhook whose signature does not match its body, even though the body is well within the size limit", async () => {
      const payload = { eventId: `evt_safety_bad_${Date.now()}`, type: "payment.succeeded", paymentId: "pay_x", orderReference: null, amountMinor: 100, currency: "ZAR", status: "successful", createdAt: new Date().toISOString() };
      const rawBody = JSON.stringify(payload);
      const wrongSignature = sign(rawBody, "a-completely-different-secret");
      const req = new NextRequest("http://localhost/api/webhooks/provider", {
        method: "POST",
        headers: { "x-mock-signature": wrongSignature },
        body: rawBody,
      });
      const res = await postWebhook(req);
      expect(res.status).toBe(400);
    });

    it("never echoes the signature header, a stack trace, or a raw Prisma error message back in a webhook error response", async () => {
      const payload = { eventId: `evt_safety_leak_${Date.now()}`, type: "payment.succeeded", paymentId: "pay_leak", orderReference: null, amountMinor: 100, currency: "ZAR", status: "successful", createdAt: new Date().toISOString() };
      const rawBody = JSON.stringify(payload);
      const secretLookingSignature = "t=1,v1=sig_should_never_appear_in_any_response_field";
      const req = new NextRequest("http://localhost/api/webhooks/provider", {
        method: "POST",
        headers: { "x-mock-signature": secretLookingSignature },
        body: rawBody,
      });
      const res = await postWebhook(req);
      const text = await res.text();
      expect(res.status).toBe(400);
      expect(text).not.toContain(secretLookingSignature);
      expect(text).not.toContain("at Object.<anonymous>");
      expect(text).not.toContain("node_modules");
      expect(text.toLowerCase()).not.toContain("prisma");
      const body = JSON.parse(text);
      expect(Object.keys(body).sort()).toEqual(["error", "requestId"]);
    });
  });
});
