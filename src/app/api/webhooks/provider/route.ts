import { NextRequest, NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { prisma } from "@/lib/db";
import { newRequestId, AppError } from "@/lib/errors";
import { MAX_BODY_BYTES, readBodyWithLimit } from "@/lib/httpGuards";
import { handleWebhook } from "@/core/webhooks/handleWebhook";

/**
 * No Origin or Content-Type check here, unlike the browser-facing mutation
 * routes (POST /api/runs, POST /api/findings/:id/status): this endpoint is
 * authenticated by its HMAC signature instead, computed over the exact raw
 * bytes read below - an Origin header carries no such guarantee and isn't
 * meaningful for a server-to-server webhook delivery anyway.
 */
export async function POST(req: NextRequest) {
  const requestId = newRequestId();
  const config = getConfig();

  const bodyResult = await readBodyWithLimit(req);
  if (!bodyResult.ok) {
    return NextResponse.json({ error: "payload_too_large", message: `Request body exceeds ${MAX_BODY_BYTES} bytes.`, requestId }, { status: 413 });
  }
  const rawBody = bodyResult.raw;
  const signatureHeader = req.headers.get("x-mock-signature");

  try {
    const outcome = await handleWebhook(prisma, rawBody, signatureHeader, config.MOCK_PROVIDER_WEBHOOK_SECRET, requestId);

    if (outcome.result === "rejected") {
      return NextResponse.json({ error: outcome.reason, requestId }, { status: 400 });
    }
    // Both "processed" and "duplicate" return 200: a duplicate delivery must
    // be harmless to the sender, not surfaced as an error.
    return NextResponse.json({ ok: true, result: outcome.result, requestId }, { status: 200 });
  } catch (err) {
    if (err instanceof AppError) {
      return NextResponse.json(err.toJSON(), { status: err.statusCode });
    }
    return NextResponse.json({ error: "internal_error", requestId }, { status: 500 });
  }
}
