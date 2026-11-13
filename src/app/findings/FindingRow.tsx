"use client";

import { useRouter } from "next/navigation";
import { Fragment, useId, useState } from "react";
import { formatEvidence } from "./formatEvidence";

type Status = "OPEN" | "ACKNOWLEDGED" | "RESOLVED";

const NEXT_ACTIONS: Record<Status, Array<{ label: string; status: Status }>> = {
  OPEN: [
    { label: "Acknowledge", status: "ACKNOWLEDGED" },
    { label: "Resolve", status: "RESOLVED" },
  ],
  ACKNOWLEDGED: [
    { label: "Resolve", status: "RESOLVED" },
    { label: "Reopen", status: "OPEN" },
  ],
  RESOLVED: [{ label: "Reopen", status: "OPEN" }],
};

const STATUS_BADGE_CLASS: Record<Status, string> = {
  OPEN: "badge badge-open",
  ACKNOWLEDGED: "badge badge-acknowledged",
  RESOLVED: "badge badge-resolved",
};

function severityBadgeClass(severity: string | null): string {
  switch (severity) {
    case "CRITICAL":
      return "badge badge-critical";
    case "WARNING":
      return "badge badge-warning";
    case "INFO":
      return "badge badge-info";
    default:
      return "badge";
  }
}

export interface FindingRowProps {
  id: string;
  mismatchClass: string;
  severity: string | null;
  status: Status;
  orderReference: string | null;
  providerPaymentId: string | null;
  amountMinor: number | null;
  currency: string | null;
  firstSeenRunId: string;
  lastSeenRunId: string;
  note: string | null;
  evidence: Record<string, unknown>;
  columnCount: number;
}

/**
 * One finding's compact row, plus its expandable detail row (evidence,
 * note, and status actions). A plain <button aria-expanded> toggles the
 * detail row's visibility - <details>/<summary> isn't valid wrapping a
 * <tr>, so this is the accessible equivalent for a table row: a real
 * button, keyboard-operable by default, with aria-expanded reflecting
 * state for assistive tech.
 *
 * Note contract: the field is prefilled with the finding's current note,
 * and is never reset by this component itself - after either a successful
 * save (where it already matches what was saved) or a failed one (where
 * the operator's edit is exactly what they'd want to retry), the typed
 * text stays as-is.
 */
export function FindingRow({
  id,
  mismatchClass,
  severity,
  status,
  orderReference,
  providerPaymentId,
  amountMinor,
  currency,
  firstSeenRunId,
  lastSeenRunId,
  note,
  evidence,
  columnCount,
}: FindingRowProps) {
  const router = useRouter();
  const noteInputId = useId();
  const [expanded, setExpanded] = useState(false);
  const [pending, setPending] = useState(false);
  const [noteDraft, setNoteDraft] = useState(note ?? "");
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; message: string } | null>(null);

  async function submit(body: { status: Status; note?: string | null }) {
    setPending(true);
    setFeedback(null);
    try {
      const res = await fetch(`/api/findings/${id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);

      if (res.ok) {
        setFeedback({ kind: "success", message: "Saved." });
        router.refresh();
        return;
      }
      if (res.status === 409) {
        setFeedback({ kind: "error", message: "This finding changed since the page loaded. Refreshed to the current state." });
        router.refresh();
        return;
      }
      setFeedback({ kind: "error", message: data?.message ?? "Could not save that change." });
    } catch {
      setFeedback({ kind: "error", message: "Network error - could not reach the app." });
    } finally {
      setPending(false);
    }
  }

  function transition(nextStatus: Status) {
    const trimmed = noteDraft.trim();
    const unchanged = trimmed === (note ?? "");
    return submit(unchanged ? { status: nextStatus } : { status: nextStatus, note: trimmed });
  }

  function clearNote() {
    return submit({ status, note: null });
  }

  const amount = amountMinor !== null ? `${currency ?? ""} ${(amountMinor / 100).toFixed(2)}` : "-";
  const evidenceFields = formatEvidence(evidence);

  return (
    <>
      <tr>
        <td>{mismatchClass}</td>
        <td>
          <span className={severityBadgeClass(severity)}>{severity ?? "UNKNOWN"}</span>
        </td>
        <td>
          <span className={STATUS_BADGE_CLASS[status]}>{status}</span>
        </td>
        <td>{orderReference ?? "-"}</td>
        <td>{amount}</td>
        <td>{lastSeenRunId}</td>
        <td>
          <button type="button" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
            {expanded ? "Hide details" : "Details"}
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className="detail-row">
          <td colSpan={columnCount}>
            <dl className="detail-grid">
              <dt>Provider payment</dt>
              <dd>{providerPaymentId ?? "-"}</dd>
              <dt>First seen run</dt>
              <dd>{firstSeenRunId}</dd>
              <dt>Last seen run</dt>
              <dd>{lastSeenRunId}</dd>
              {evidenceFields.map((field) => (
                <Fragment key={field.key}>
                  <dt>{field.label}</dt>
                  <dd>{field.value}</dd>
                </Fragment>
              ))}
            </dl>

            <label className="field-label" htmlFor={noteInputId}>
              Note
            </label>
            <input
              id={noteInputId}
              type="text"
              className="text-input"
              placeholder="No note"
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              disabled={pending}
            />

            <div className="button-row">
              {NEXT_ACTIONS[status].map((action) => (
                <button key={action.status} type="button" disabled={pending} onClick={() => transition(action.status)}>
                  {action.label}
                </button>
              ))}
              {note && (
                <button type="button" disabled={pending} onClick={clearNote}>
                  Clear note
                </button>
              )}
            </div>

            {feedback && (
              <p className={`feedback ${feedback.kind === "error" ? "feedback-error" : "feedback-success"}`} role={feedback.kind === "error" ? "alert" : "status"}>
                {feedback.message}
              </p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
