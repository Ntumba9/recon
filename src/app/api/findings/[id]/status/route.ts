import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { newRequestId } from "@/lib/errors";
import { statusTransitionSchema } from "@/core/findings/statusTransitionSchema";

/**
 * Changes a finding's lifecycle status (OPEN / ACKNOWLEDGED / RESOLVED).
 * This endpoint annotates the FindingRecord only - it never writes to
 * Order or any payment data, and it performs no automatic action
 * (no refund, retry, or booking correction).
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

  const existing = await prisma.findingRecord.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "not_found", requestId }, { status: 404 });
  }

  const updated = await prisma.findingRecord.update({
    where: { id },
    data: {
      status: parsed.data.status,
      note: parsed.data.note ?? null,
      statusChangedAt: new Date(),
    },
  });

  return NextResponse.json({ ok: true, finding: { id: updated.id, status: updated.status, note: updated.note }, requestId });
}
