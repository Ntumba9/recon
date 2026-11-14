import { NextResponse } from "next/server";

/**
 * One error shape for every browser-facing mutation route
 * (POST /api/runs, POST /api/findings/:id/status): { error, message,
 * requestId }. `error` is a stable machine-readable code; `message` is a
 * short human-readable explanation that never includes a stack trace, a
 * Prisma error message, or any secret.
 */
export type ApiErrorCode =
  | "invalid_json"
  | "invalid_body"
  | "not_found"
  | "run_in_progress"
  | "invalid_transition"
  | "conflict"
  | "payload_too_large"
  | "unsupported_media_type"
  | "forbidden_origin"
  | "internal_error";

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  invalid_json: 400,
  invalid_body: 400,
  not_found: 404,
  run_in_progress: 409,
  invalid_transition: 409,
  conflict: 409,
  payload_too_large: 413,
  unsupported_media_type: 415,
  forbidden_origin: 403,
  internal_error: 500,
};

export function apiError(code: ApiErrorCode, message: string, requestId: string) {
  return NextResponse.json({ error: code, message, requestId }, { status: STATUS_BY_CODE[code] });
}
