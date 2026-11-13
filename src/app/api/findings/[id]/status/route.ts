import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { newRequestId } from "@/lib/errors";
import { apiError } from "@/lib/apiError";
import { MAX_BODY_BYTES, hasJsonContentType, isAllowedOrigin, readBodyWithLimit } from "@/lib/httpGuards";
import { statusTransitionSchema } from "@/core/findings/statusTransitionSchema";
import { isValidTransition } from "@/core/findings/validTransition";

/**
 * Changes a finding's lifecycle status (OPEN / ACKNOWLEDGED / RESOLVED).
 * This endpoint annotates the FindingRecord only - it never writes to
 * Order or any payment data, and it performs no automatic action
 * (no refund, retry, or booking correction).
 *
 * Note contract (see src/core/findings/statusTransitionSchema.ts):
 *  - "note" absent from the body -> the existing note is preserved as-is.
 *  - "note": null, or "" after trimming -> the note is explicitly cleared.
 *  - "note": "<text>" -> the note is replaced with the trimmed text.
 *
 * Error shape: every failure is { error, message, requestId } (see
 * src/lib/apiError.ts) - invalid_json/invalid_body (400), not_found (404),
 * invalid_transition (409), payload_too_large (413), unsupported_media_type
 * (415), forbidden_origin (403).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = newRequestId();
  const { id } = await params;

  if (!isAllowedOrigin(req)) {
    return apiError("forbidden_origin", "Request Origin does not match this host.", requestId);
  }

  const bodyResult = await readBodyWithLimit(req);
  if (!bodyResult.ok) {
    return apiError("payload_too_large", `Request body exceeds ${MAX_BODY_BYTES} bytes.`, requestId);
  }
  const rawBody = bodyResult.raw;

  if (!hasJsonContentType(req, rawBody)) {
    return apiError("unsupported_media_type", "Content-Type must be application/json.", requestId);
  }

  let parsedJson: unknown = {};
  if (rawBody.length > 0) {
    try {
      parsedJson = JSON.parse(rawBody);
    } catch {
      return apiError("invalid_json", "Request body is not valid JSON.", requestId);
    }
  }

  const parsed = statusTransitionSchema.safeParse(parsedJson);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => i.message).join("; ") || "Invalid request body.";
    return apiError("invalid_body", message, requestId);
  }

  const existing = await prisma.findingRecord.findUnique({ where: { id } });
  if (!existing) {
    return apiError("not_found", `No finding with id ${id}.`, requestId);
  }

  if (!isValidTransition(existing.status, parsed.data.status)) {
    return apiError("invalid_transition", `Cannot move a finding from ${existing.status} to ${parsed.data.status}.`, requestId);
  }

  const noteFieldPresent = typeof parsedJson === "object" && parsedJson !== null && "note" in parsedJson;
  const nextNote = !noteFieldPresent
    ? existing.note
    : parsed.data.note === null || parsed.data.note === ""
      ? null
      : (parsed.data.note ?? null);

  const updated = await prisma.findingRecord.update({
    where: { id },
    data: {
      status: parsed.data.status,
      note: nextNote,
      statusChangedAt: new Date(),
    },
  });

  return NextResponse.json({ ok: true, finding: { id: updated.id, status: updated.status, note: updated.note }, requestId });
}
