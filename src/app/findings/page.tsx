import type { Prisma } from "@prisma/client";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { FindingRow } from "./FindingRow";
import { MISMATCH_CLASSES, SEVERITIES, STATUSES, parseFindingsSearchParams } from "./filters";

/** Cap on how many of a finding's most recent history entries the page loads - a reasonable bound for a demo, not a hard product limit. */
const HISTORY_PAGE_SIZE = 50;

export const dynamic = "force-dynamic";

const COLUMN_COUNT = 7;

interface PageProps {
  searchParams: Promise<{ class?: string; severity?: string; status?: string; page?: string; run?: string }>;
}

function buildQuery(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}

/**
 * Findings list with a lifecycle status (OPEN / ACKNOWLEDGED / RESOLVED)
 * per finding. The status actions only ever annotate the finding itself -
 * no refund, retry, or booking correction happens anywhere in RECON.
 */
export default async function FindingsPage({ searchParams }: PageProps) {
  const resolvedSearchParams = await searchParams;
  const { classFilter, severityFilter, statusFilter, page, pageSize } = parseFindingsSearchParams(resolvedSearchParams);
  const runFilter = resolvedSearchParams.run;

  const where: Prisma.FindingRecordWhereInput = {
    ...(classFilter ? { mismatchClass: classFilter } : {}),
    ...(statusFilter ? { status: statusFilter } : {}),
    // Severity lives on each run's FindingOccurrence, not the FindingRecord
    // itself; every rule assigns one fixed severity per mismatch class, so
    // "some occurrence has this severity" and "the latest one does" agree
    // in practice.
    ...(severityFilter ? { occurrences: { some: { severity: severityFilter } } } : {}),
    ...(runFilter ? { occurrences: { some: { runId: runFilter } } } : {}),
  };

  const [openCount, acknowledgedCount, resolvedCount, criticalCount, totalMatching, records] = await Promise.all([
    prisma.findingRecord.count({ where: { status: "OPEN" } }),
    prisma.findingRecord.count({ where: { status: "ACKNOWLEDGED" } }),
    prisma.findingRecord.count({ where: { status: "RESOLVED" } }),
    prisma.findingRecord.count({ where: { occurrences: { some: { severity: "CRITICAL" } } } }),
    prisma.findingRecord.count({ where }),
    prisma.findingRecord.findMany({
      where,
      include: {
        occurrences: { orderBy: { createdAt: "desc" }, take: 1 },
        history: { orderBy: { sequence: "desc" }, take: HISTORY_PAGE_SIZE },
      },
      orderBy: [{ mismatchClass: "asc" }, { orderReference: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalMatching / pageSize));
  const rangeStart = totalMatching === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, totalMatching);

  const baseFilters = {
    class: classFilter,
    severity: severityFilter,
    status: statusFilter,
    run: runFilter,
  };

  return (
    <main className="page">
      <h1>RECON findings</h1>
      <p className="page-intro">
        Synthetic demo data only. Unauthenticated local demo - the status actions below annotate a finding only; no
        refund, retry, or booking correction happens anywhere in RECON.
      </p>
      <p className="page-nav">
        <Link href="/runs">View run history / trigger a run</Link>
      </p>

      <dl className="summary-strip">
        <div className="summary-stat">
          <dt>Open</dt>
          <dd>{openCount}</dd>
        </div>
        <div className="summary-stat">
          <dt>Acknowledged</dt>
          <dd>{acknowledgedCount}</dd>
        </div>
        <div className="summary-stat">
          <dt>Resolved</dt>
          <dd>{resolvedCount}</dd>
        </div>
        <div className="summary-stat is-critical">
          <dt>Critical</dt>
          <dd>{criticalCount}</dd>
        </div>
      </dl>

      {runFilter && (
        <p className="page-nav">
          Filtered to run <code>{runFilter}</code>. <Link href={buildQuery({ class: classFilter, severity: severityFilter, status: statusFilter })}>Clear run filter</Link>
        </p>
      )}

      <form method="get" className="filter-form">
        <div className="filter-field">
          <label htmlFor="class-filter">Mismatch class</label>
          <select id="class-filter" name="class" defaultValue={classFilter ?? ""}>
            <option value="">All</option>
            {MISMATCH_CLASSES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="filter-field">
          <label htmlFor="severity-filter">Severity</label>
          <select id="severity-filter" name="severity" defaultValue={severityFilter ?? ""}>
            <option value="">All</option>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="filter-field">
          <label htmlFor="status-filter">Status</label>
          <select id="status-filter" name="status" defaultValue={statusFilter ?? ""}>
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="filter-actions">
          <button type="submit">Filter</button>
          <Link href="/findings">Clear</Link>
        </div>
      </form>

      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Mismatch class</th>
              <th>Severity</th>
              <th>Status</th>
              <th>Order</th>
              <th>Amount</th>
              <th>Last seen run</th>
              <th>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {records.map((record) => {
              const occurrence = record.occurrences[0];
              return (
                <FindingRow
                  key={record.id}
                  id={record.id}
                  mismatchClass={record.mismatchClass}
                  severity={occurrence?.severity ?? null}
                  status={record.status}
                  orderReference={record.orderReference}
                  providerPaymentId={record.providerPaymentId}
                  amountMinor={record.amountMinor}
                  currency={record.currency}
                  firstSeenRunId={record.firstSeenRunId}
                  lastSeenRunId={record.lastSeenRunId}
                  note={record.note}
                  evidence={(occurrence?.evidence as Record<string, unknown>) ?? {}}
                  history={record.history}
                  columnCount={COLUMN_COUNT}
                />
              );
            })}
          </tbody>
        </table>
      </div>

      {records.length === 0 && <p className="empty-state">No findings match these filters.</p>}

      {totalMatching > 0 && (
        <div className="pagination">
          <span>
            Showing {rangeStart}-{rangeEnd} of {totalMatching}
          </span>
          {page > 1 && <Link href={buildQuery({ ...baseFilters, page: String(page - 1) })}>Previous</Link>}
          {page < totalPages && <Link href={buildQuery({ ...baseFilters, page: String(page + 1) })}>Next</Link>}
        </div>
      )}
    </main>
  );
}
