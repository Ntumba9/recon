import { NextRequest, NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { prisma } from "@/lib/db";
import { newRequestId, AppError } from "@/lib/errors";
import { handleWebhook } from "@/core/webhooks/handleWebhook";

export async function POST(req: NextRequest) {
  const requestId = newRequestId();
  const config = getConfig();

  const rawBody = await req.text();
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
