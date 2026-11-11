import type { CSSProperties } from "react";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { RunTrigger } from "./RunTrigger";
import { isRunInProgress } from "./runStatus";

export const dynamic = "force-dynamic";

function describeCompleteness(status: string): string {
  if (status === "FAILED") return "unknown (provider unreachable)";
  if (status === "INCONCLUSIVE") return "partial";
  return "complete";
}

/**
 * Run history: every ReconciliationRun, its window, outcome, completeness,
 * notes, and how many findings it produced. SUCCESS, INCONCLUSIVE, and
 * FAILED are shown exactly as the run recorded them - never softened or
 * hidden. The "Run reconciliation" button on this page is the only way to
 * start a run from the browser; it never touches an Order or payment
 * itself, only triggers the same reconciler the demo script uses.
 */
export default async function RunsPage() {
  const runs = await prisma.reconciliationRun.findMany({
    orderBy: { startedAt: "desc" },
    take: 50,
    include: { _count: { select: { occurrences: true } } },
  });

  const inProgressRun = runs.find((r) => isRunInProgress(r.startedAt, r.finishedAt));

  return (
    <main style={{ maxWidth: 1250, margin: "0 auto", padding: "32px 24px" }}>
      <h1 style={{ marginBottom: 4 }}>RECON runs</h1>
      <p style={{ color: "#555", marginTop: 0 }}>
        Synthetic demo data only. Unauthenticated local demo - triggering a run here only reads the mock provider
        and writes run/finding records; no refund, retry, or booking correction happens anywhere in RECON.
      </p>
      <p style={{ marginTop: 0 }}>
        <Link href="/findings">View findings</Link>
      </p>

      <RunTrigger initialDisabled={Boolean(inProgressRun)} />

      <table style={{ width: "100%", borderCollapse: "collapse", background: "white" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "2px solid #ddd" }}>
            <th style={cellStyle}>Run</th>
            <th style={cellStyle}>Started</th>
            <th style={cellStyle}>Finished</th>
            <th style={cellStyle}>Window</th>
            <th style={cellStyle}>Status</th>
            <th style={cellStyle}>Completeness</th>
            <th style={cellStyle}>Findings</th>
            <th style={cellStyle}>Notes</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id} style={{ borderBottom: "1px solid #eee" }}>
              <td style={{ ...cellStyle, fontFamily: "monospace", fontSize: 12 }}>{run.id}</td>
              <td style={cellStyle}>{run.startedAt.toISOString()}</td>
              <td style={cellStyle}>{run.finishedAt ? run.finishedAt.toISOString() : "(in progress)"}</td>
              <td style={{ ...cellStyle, fontSize: 12 }}>
                {run.windowStart.toISOString()}
                <br />
                {run.windowEnd.toISOString()}
              </td>
              <td style={cellStyle}>
                <strong>{run.status}</strong>
              </td>
              <td style={cellStyle}>{describeCompleteness(run.status)}</td>
              <td style={cellStyle}>{run._count.occurrences}</td>
              <td style={{ ...cellStyle, maxWidth: 320, whiteSpace: "pre-wrap" }}>{run.notes ?? "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {runs.length === 0 && <p style={{ marginTop: 24, color: "#555" }}>No runs yet.</p>}
    </main>
  );
}

const cellStyle: CSSProperties = { padding: "8px 12px", verticalAlign: "top" };
