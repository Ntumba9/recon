import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { newRequestId } from "@/lib/errors";
import { statusTransitionSchema } from "@/core/findings/statusTransitionSchema";
import { updateFindingStatus } from "@/core/findings/updateFindingStatus";

/**
 * Changes a finding's lifecycle status (OPEN / ACKNOWLEDGED / RESOLVED).
 * This endpoint annotates the FindingRecord only - it never writes to
 * Order or any payment data, and it performs no automatic action
 * (no refund, retry, or booking correction). The status/note write and its
 * history entry are applied together - see updateFindingStatus for the
 * transaction and concurrency handling.
 *
 * Note contract (see src/core/findings/statusTransitionSchema.ts):
 *  - "note" absent from the body -> the existing note is preserved as-is.
 *  - "note": null, or "" after trimming -> the note is explicitly cleared.
 *  - "note": "<text>" -> the note is replaced with the trimmed text.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = newRequestId();
  const { id } = await params;

  let parsedJson: unknown;
  try {
    parsedJson = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json", requestId }, { status: 400 });
  }

  const parsed = statusTransitionSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.issues, requestId }, { status: 400 });
  }

  const noteFieldPresent = typeof parsedJson === "object" && parsedJson !== null && "note" in parsedJson;

  const outcome = await updateFindingStatus(prisma, id, {
    status: parsed.data.status,
    noteFieldPresent,
    note: parsed.data.note,
  });

  if (outcome.result === "not_found") {
    return NextResponse.json({ error: "not_found", requestId }, { status: 404 });
  }
  if (outcome.result === "conflict") {
    return NextResponse.json({ error: "conflict", requestId }, { status: 409 });
  }

  return NextResponse.json({ ok: true, finding: outcome.finding, requestId });
}
