interface HistoryEntryView {
  id: string;
  previousStatus: string;
  newStatus: string;
  changeSource: string;
  noteChangeType: string;
  newNote: string | null;
  createdAt: Date;
  sourceRunId: string | null;
}

function describeTransition(entry: HistoryEntryView): string {
  const statusPart =
    entry.previousStatus === entry.newStatus
      ? `status unchanged (${entry.newStatus})`
      : `status ${entry.previousStatus} → ${entry.newStatus}`;
  const notePart =
    entry.noteChangeType === "SET"
      ? `note set to "${entry.newNote ?? ""}"`
      : entry.noteChangeType === "CLEARED"
        ? "note cleared"
        : "note unchanged";
  return `${statusPart}; ${notePart}`;
}

function describeSource(entry: HistoryEntryView): string {
  // The demo has no authentication, so no action is ever attributed to a
  // specific person - only whether it was a manual action through the
  // status API or an automatic reconciliation reopen (with its run id).
  return entry.changeSource === "RECONCILIATION"
    ? `automatic – reconciliation run ${entry.sourceRunId ?? "unknown"}`
    : "manual action";
}

/**
 * Expandable, append-only audit trail for one finding. A native <details>
 * disclosure needs no script to be keyboard-operable (Tab to focus,
 * Enter/Space to toggle) and is already announced correctly by screen
 * readers, so this stays plain, semantic HTML.
 */
export function FindingHistory({ entries }: { entries: HistoryEntryView[] }) {
  if (entries.length === 0) {
    return <p style={{ fontSize: 12, color: "#777", margin: 0 }}>No recorded changes yet.</p>;
  }

  return (
    <details>
      <summary style={{ cursor: "pointer", fontSize: 12 }}>History ({entries.length})</summary>
      <ol style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 12, display: "flex", flexDirection: "column", gap: 6 }}>
        {entries.map((entry) => (
          <li key={entry.id}>
            <time dateTime={entry.createdAt.toISOString()}>{entry.createdAt.toISOString()}</time>
            {" – "}
            {describeTransition(entry)} ({describeSource(entry)})
          </li>
        ))}
      </ol>
    </details>
  );
}
