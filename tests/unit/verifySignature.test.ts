import crypto from "crypto";
import { describe, expect, it } from "vitest";
import { verifyWebhookSignature } from "@/core/webhooks/verifySignature";

const SECRET = "whsec_test_secret_do_not_use";

function sign(rawBody: string, timestamp: number, secret = SECRET) {
  const hmac = crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return `t=${timestamp},v1=${hmac}`;
}

describe("verifyWebhookSignature", () => {
  const rawBody = JSON.stringify({ eventId: "evt_1", status: "successful" });

  it("accepts a correctly signed, fresh payload", () => {
    const now = Math.floor(Date.now() / 1000);
    const header = sign(rawBody, now);
    const result = verifyWebhookSignature(rawBody, header, SECRET);
    expect(result.valid).toBe(true);
  });

  it("rejects a missing signature header", () => {
    expect(verifyWebhookSignature(rawBody, null, SECRET)).toEqual({
      valid: false,
      reason: "missing_signature_header",
    });
  });

  it("rejects a malformed signature header", () => {
    const result = verifyWebhookSignature(rawBody, "not-a-valid-header", SECRET);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("malformed_signature_header");
  });

  it("rejects a tampered body (signature mismatch)", () => {
    const now = Math.floor(Date.now() / 1000);
    const header = sign(rawBody, now);
    const tampered = JSON.stringify({ eventId: "evt_1", status: "failed" });
    const result = verifyWebhookSignature(tampered, header, SECRET);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("signature_mismatch");
  });

  it("rejects the wrong secret", () => {
    const now = Math.floor(Date.now() / 1000);
    const header = sign(rawBody, now, "a-completely-different-secret");
    const result = verifyWebhookSignature(rawBody, header, SECRET);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("signature_mismatch");
  });

  it("rejects a replayed, stale timestamp outside tolerance", () => {
    const staleTimestamp = Math.floor(Date.now() / 1000) - 60 * 60; // 1 hour old
    const header = sign(rawBody, staleTimestamp);
    const result = verifyWebhookSignature(rawBody, header, SECRET, { toleranceSeconds: 5 * 60 });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("timestamp_outside_tolerance");
  });
});
