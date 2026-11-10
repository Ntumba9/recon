import crypto from "crypto";

/**
 * Verifies the mock provider's webhook signature header:
 *
 *   X-Mock-Signature: t=<unix_seconds>,v1=<hex hmac>
 *   hmac = HMAC-SHA256(`${t}.${rawBody}`, secret)
 *
 * Mirrors the shape of real provider webhook schemes (timestamped HMAC over
 * the raw body) closely enough to exercise the same defenses, without
 * claiming to be any specific provider's actual protocol.
 */

const DEFAULT_TOLERANCE_SECONDS = 5 * 60;

export interface VerifyResult {
  valid: boolean;
  reason?: string;
}

function parseHeader(header: string): { timestamp: number; signature: string } | null {
  const parts = header.split(",").reduce<Record<string, string>>((acc, part) => {
    const [key, value] = part.split("=");
    if (key && value) acc[key.trim()] = value.trim();
    return acc;
  }, {});

  const t = parts["t"];
  const v1 = parts["v1"];
  if (!t || !v1 || !/^\d+$/.test(t) || !/^[0-9a-f]+$/i.test(v1)) return null;
  return { timestamp: Number(t), signature: v1 };
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length) {
    // Still run a comparison of equal length to avoid an obvious early-exit
    // timing signal, then report unequal.
    crypto.timingSafeEqual(bufA, Buffer.alloc(bufA.length));
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

export function verifyWebhookSignature(
  rawBody: string,
  header: string | null,
  secret: string,
  opts: { toleranceSeconds?: number; now?: () => number } = {}
): VerifyResult {
  if (!header) return { valid: false, reason: "missing_signature_header" };

  const parsed = parseHeader(header);
  if (!parsed) return { valid: false, reason: "malformed_signature_header" };

  const tolerance = opts.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  const nowSeconds = Math.floor((opts.now?.() ?? Date.now()) / 1000);
  if (Math.abs(nowSeconds - parsed.timestamp) > tolerance) {
    return { valid: false, reason: "timestamp_outside_tolerance" };
  }

  const signedPayload = `${parsed.timestamp}.${rawBody}`;
  const expected = crypto.createHmac("sha256", secret).update(signedPayload).digest("hex");

  if (!constantTimeEquals(expected, parsed.signature)) {
    return { valid: false, reason: "signature_mismatch" };
  }

  return { valid: true };
}
