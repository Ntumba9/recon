import type { CSSProperties } from "react";
import { prisma } from "@/lib/db";

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

interface PageProps {
  searchParams: { class?: string; severity?: string };
}

/**
 * Read-only findings list. This page never acts on anything it shows - no
 * refund, retry, or booking-correction buttons exist anywhere in RECON.
 */
export default async function FindingsPage({ searchParams }: PageProps) {
  const classFilter = searchParams.class;
  const severityFilter = searchParams.severity;

  const records = await prisma.findingRecord.findMany({
    where: {
      ...(classFilter ? { mismatchClass: classFilter } : {}),
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
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 24px" }}>
      <h1 style={{ marginBottom: 4 }}>RECON findings</h1>
      <p style={{ color: "#555", marginTop: 0 }}>
        Synthetic demo data only. Read-only: no refunds, retries, or booking corrections happen here.
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
        <button type="submit">Filter</button>
      </form>

      <table style={{ width: "100%", borderCollapse: "collapse", background: "white" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "2px solid #ddd" }}>
            <th style={cellStyle}>Mismatch class</th>
            <th style={cellStyle}>Severity</th>
            <th style={cellStyle}>Order</th>
            <th style={cellStyle}>Payment</th>
            <th style={cellStyle}>Amount</th>
            <th style={cellStyle}>First seen run</th>
            <th style={cellStyle}>Last seen run</th>
            <th style={cellStyle}>Evidence</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((record) => {
            const occurrence = record.occurrences[0];
            return (
              <tr key={record.id} style={{ borderBottom: "1px solid #eee" }}>
                <td style={cellStyle}>{record.mismatchClass}</td>
                <td style={cellStyle}>{occurrence?.severity ?? "-"}</td>
                <td style={cellStyle}>{record.orderReference ?? "-"}</td>
                <td style={cellStyle}>{record.providerPaymentId ?? "-"}</td>
                <td style={cellStyle}>
                  {record.amountMinor !== null ? `${record.currency ?? ""} ${(record.amountMinor / 100).toFixed(2)}` : "-"}
                </td>
                <td style={cellStyle}>{record.firstSeenRunId}</td>
                <td style={cellStyle}>{record.lastSeenRunId}</td>
                <td style={cellStyle}>
                  <pre style={{ margin: 0, fontSize: 12, whiteSpace: "pre-wrap" }}>
                    {JSON.stringify(occurrence?.evidence ?? {}, null, 2)}
                  </pre>
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
