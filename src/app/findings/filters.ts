export const MISMATCH_CLASSES = [
  "SUCCESSFUL_PAYMENT_NOT_CONFIRMED",
  "CONFIRMED_WITHOUT_SUCCESSFUL_PAYMENT",
  "DUPLICATE_SUCCESSFUL_PAYMENT",
  "AMOUNT_CURRENCY_MISMATCH",
  "AGED_PENDING_BOOKING",
  "WEBHOOK_PROVIDER_DISAGREEMENT",
] as const;

export const SEVERITIES = ["INFO", "WARNING", "CRITICAL"] as const;
export const STATUSES = ["OPEN", "ACKNOWLEDGED", "RESOLVED"] as const;

export type MismatchClassFilter = (typeof MISMATCH_CLASSES)[number];
export type SeverityFilter = (typeof SEVERITIES)[number];
export type StatusFilter = (typeof STATUSES)[number];

const PAGE_SIZE_DEFAULT = 25;
const PAGE_SIZE_MAX = 100;

/** An unrecognized filter value falls back to "All" (undefined) rather than erroring or silently matching nothing. */
function validateEnum<T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined {
  if (!value) return undefined;
  return (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

export interface ParsedFindingsSearchParams {
  classFilter: MismatchClassFilter | undefined;
  severityFilter: SeverityFilter | undefined;
  statusFilter: StatusFilter | undefined;
  page: number;
  pageSize: number;
}

export function parseFindingsSearchParams(raw: {
  class?: string;
  severity?: string;
  status?: string;
  page?: string;
  pageSize?: string;
}): ParsedFindingsSearchParams {
  const page = Math.max(1, Number.parseInt(raw.page ?? "1", 10) || 1);
  const requestedPageSize = Number.parseInt(raw.pageSize ?? "", 10);
  const pageSize =
    Number.isFinite(requestedPageSize) && requestedPageSize > 0
      ? Math.min(requestedPageSize, PAGE_SIZE_MAX)
      : PAGE_SIZE_DEFAULT;

  return {
    classFilter: validateEnum(raw.class, MISMATCH_CLASSES),
    severityFilter: validateEnum(raw.severity, SEVERITIES),
    statusFilter: validateEnum(raw.status, STATUSES),
    page,
    pageSize,
  };
}
