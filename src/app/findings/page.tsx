import type { CSSProperties } from "react";
import { prisma } from "@/lib/db";
import { FindingActions } from "./FindingActions";

export const dynamic = "force-dynamic";

const MISMATCH_CLASSES = [
  "SUCCESSFUL_PAYMENT_NOT_CONFIRMED",
  "CONFIRMED_WITHOUT_SUCCESSFUL_PAYMENT",
  "DUPLICATE_SUCCESSFUL_PAYMENT",
  "AMOUNT_CURRENCY_MISMATCH",
  "AGED_PENDING_BOOKING",
  "WEBHOOK_PROVIDER_DISAGREEMENT",
] as const;

const SEVERITIES = ["INFO", "WARNING", "CRITICAL"] as const;
const STATUSES = ["OPEN", "ACKNOWLEDGED", "RESOLVED"] as const;

interface PageProps {
  searchParams: Promise<{ class?: string; severity?: string; status?: string }>;
}

/**
 * Findings list with a lifecycle status (OPEN / ACKNOWLEDGED / RESOLVED)
 * per finding. The status actions only ever annotate the finding itself -
 * no refund, retry, or booking correction happens anywhere in RECON.
 */
export default async function FindingsPage({ searchParams }: PageProps) {
  const resolvedSearchParams = await searchParams;
  const classFilter = resolvedSearchParams.class;
  const severityFilter = resolvedSearchParams.severity;
  const statusFilter = resolvedSearchParams.status;

  const records = await prisma.findingRecord.findMany({
    where: {
      ...(classFilter ? { mismatchClass: classFilter } : {}),
      ...(statusFilter ? { status: statusFilter as (typeof STATUSES)[number] } : {}),
    },
    include: {
      occurrences: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
    orderBy: [{ mismatchClass: "asc" }, { orderReference: "asc" }],
  });

  const visible = severityFilter
    ? records.filter((r) => r.occurrences[0]?.severity === severityFilter)
    : records;

  return (
    <main style={{ maxWidth: 1250, margin: "0 auto", padding: "32px 24px" }}>
      <h1 style={{ marginBottom: 4 }}>RECON findings</h1>
      <p style={{ color: "#555", marginTop: 0 }}>
        Synthetic demo data only. Unauthenticated local demo - the status actions below annotate a finding only; no
        refund, retry, or booking correction happens anywhere in RECON.
      </p>

      <form method="get" style={{ display: "flex", gap: 12, marginBottom: 24 }}>
        <label>
          Mismatch class{" "}
          <select name="class" defaultValue={classFilter ?? ""}>
            <option value="">All</option>
            {MISMATCH_CLASSES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label>
          Severity{" "}
          <select name="severity" defaultValue={severityFilter ?? ""}>
            <option value="">All</option>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status{" "}
          <select name="status" defaultValue={statusFilter ?? ""}>
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">Filter</button>
      </form>

      <table style={{ width: "100%", borderCollapse: "collapse", background: "white" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "2px solid #ddd" }}>
            <th style={cellStyle}>Mismatch class</th>
            <th style={cellStyle}>Status</th>
            <th style={cellStyle}>Severity</th>
            <th style={cellStyle}>Order</th>
            <th style={cellStyle}>Payment</th>
            <th style={cellStyle}>Amount</th>
            <th style={cellStyle}>First seen run</th>
            <th style={cellStyle}>Last seen run</th>
            <th style={cellStyle}>Note</th>
            <th style={cellStyle}>Evidence</th>
            <th style={cellStyle}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((record) => {
            const occurrence = record.occurrences[0];
            return (
              <tr key={record.id} style={{ borderBottom: "1px solid #eee" }}>
                <td style={cellStyle}>{record.mismatchClass}</td>
                <td style={cellStyle}>{record.status}</td>
                <td style={cellStyle}>{occurrence?.severity ?? "-"}</td>
                <td style={cellStyle}>{record.orderReference ?? "-"}</td>
                <td style={cellStyle}>{record.providerPaymentId ?? "-"}</td>
                <td style={cellStyle}>
                  {record.amountMinor !== null ? `${record.currency ?? ""} ${(record.amountMinor / 100).toFixed(2)}` : "-"}
                </td>
                <td style={cellStyle}>{record.firstSeenRunId}</td>
                <td style={cellStyle}>{record.lastSeenRunId}</td>
                <td style={{ ...cellStyle, maxWidth: 180, whiteSpace: "pre-wrap" }}>{record.note ?? "-"}</td>
                <td style={cellStyle}>
                  <pre style={{ margin: 0, fontSize: 12, whiteSpace: "pre-wrap" }}>
                    {JSON.stringify(occurrence?.evidence ?? {}, null, 2)}
                  </pre>
                </td>
                <td style={cellStyle}>
                  <FindingActions id={record.id} status={record.status} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {visible.length === 0 && <p style={{ marginTop: 24, color: "#555" }}>No findings match these filters.</p>}
    </main>
  );
}

const cellStyle: CSSProperties = { padding: "8px 12px", verticalAlign: "top" };
