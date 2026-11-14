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

function statusBadgeClass(status: string): string {
  switch (status) {
    case "SUCCESS":
      return "badge badge-resolved";
    case "INCONCLUSIVE":
      return "badge badge-acknowledged";
    case "FAILED":
      return "badge badge-critical";
    default:
      return "badge";
  }
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
    <main className="page">
      <h1>RECON runs</h1>
      <p className="page-intro">
        Synthetic demo data only. Unauthenticated local demo - triggering a run here only reads the mock provider
        and writes run/finding records; no refund, retry, or booking correction happens anywhere in RECON.
      </p>
      <p className="page-nav">
        <Link href="/findings">View findings</Link>
      </p>

      <RunTrigger initialDisabled={Boolean(inProgressRun)} />

      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Run</th>
              <th>Started</th>
              <th>Finished</th>
              <th>Window</th>
              <th>Status</th>
              <th>Completeness</th>
              <th>Findings</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id}>
                <td style={{ fontFamily: "monospace", fontSize: 12 }}>{run.id}</td>
                <td>{run.startedAt.toISOString()}</td>
                <td>{run.finishedAt ? run.finishedAt.toISOString() : "(in progress)"}</td>
                <td style={{ fontSize: 12 }}>
                  {run.windowStart.toISOString()}
                  <br />
                  {run.windowEnd.toISOString()}
                </td>
                <td>
                  <span className={statusBadgeClass(run.status)}>{run.status}</span>
                </td>
                <td>{describeCompleteness(run.status)}</td>
                <td>
                  {run._count.occurrences > 0 ? (
                    <Link href={`/findings?run=${run.id}`}>{run._count.occurrences} finding(s)</Link>
                  ) : (
                    "0"
                  )}
                </td>
                <td style={{ maxWidth: 320, whiteSpace: "pre-wrap" }}>{run.notes ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {runs.length === 0 && <p className="empty-state">No runs yet.</p>}
    </main>
  );
}
