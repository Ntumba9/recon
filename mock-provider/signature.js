"use strict";

const crypto = require("crypto");

/**
 * Mock provider webhook signature protocol (synthetic, documented here and
 * in README.md - not a real provider's actual scheme):
 *
 *   header: X-Mock-Signature: t=<unix_seconds>,v1=<hex hmac>
 *   signed payload: `${t}.${rawBody}`
 *   hmac: HMAC-SHA256(signed payload, secret) -> hex digest
 *
 * The receiver must recompute the HMAC over the same string and compare
 * using a constant-time comparison, and reject timestamps outside a
 * tolerance window (replay protection).
 */

function sign(rawBody, secret, timestamp = Math.floor(Date.now() / 1000)) {
  const signedPayload = `${timestamp}.${rawBody}`;
  const hmac = crypto.createHmac("sha256", secret).update(signedPayload).digest("hex");
  return `t=${timestamp},v1=${hmac}`;
}

module.exports = { sign };
