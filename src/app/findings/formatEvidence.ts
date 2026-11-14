/**
 * Turns a finding's raw evidence object into labelled, human-readable
 * fields instead of a JSON dump. Evidence shapes differ by mismatch class
 * (src/core/reconciler/rules/*.ts), so this works generically from each
 * key's name and value type rather than special-casing every class.
 */

function titleCase(camelKey: string): string {
  return camelKey
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}

function formatDurationMs(ms: number): string {
  const totalMinutes = Math.round(Math.abs(ms) / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (parts.length === 0 || minutes > 0) parts.push(`${minutes}m`);
  return parts.join(" ");
}

function formatValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.length === 0 ? "-" : value.map((v) => String(v)).join(", ");

  if (typeof value === "number") {
    if (/Ms$/.test(key)) return formatDurationMs(value);
    if (/Minor$/.test(key)) return (value / 100).toFixed(2);
    return String(value);
  }

  if (typeof value === "string") {
    if (/At$/.test(key) && !Number.isNaN(Date.parse(value))) {
      return new Date(value).toISOString();
    }
    return value;
  }

  return JSON.stringify(value);
}

export interface FormattedEvidenceField {
  key: string;
  label: string;
  value: string;
}

export function formatEvidence(evidence: Record<string, unknown>): FormattedEvidenceField[] {
  return Object.entries(evidence).map(([key, value]) => ({
    key,
    label: titleCase(key),
    value: formatValue(key, value),
  }));
}
