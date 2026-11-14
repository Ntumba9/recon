"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

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

/**
 * Buttons that call the finding status API. This only ever annotates the
 * FindingRecord (status + note) - it never touches an order or a payment,
 * and it never triggers a refund, retry, or booking correction.
 *
 * Note contract: the field is prefilled with the finding's current note.
 * Clicking a status button without editing it preserves the note untouched
 * (the field is simply omitted from the request). Editing the text and then
 * clicking a status button replaces the note with the edited text. "Clear
 * note" explicitly clears it (sends note: null) without changing status.
 */
export function FindingActions({ id, status, note }: { id: string; status: Status; note: string | null }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [noteDraft, setNoteDraft] = useState(note ?? "");
  const [error, setError] = useState<string | null>(null);

  async function submit(body: { status: Status; note?: string | null }) {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/findings/${id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        router.refresh();
      } else if (res.status === 409) {
        setError("Another change landed first - refresh and try again.");
      } else {
        setError("Could not save that change.");
      }
    } catch {
      setError("Network error - could not reach the app.");
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
    setNoteDraft("");
    return submit({ status, note: null });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 160 }}>
      <input
        type="text"
        placeholder="Note (optional)"
        value={noteDraft}
        onChange={(e) => setNoteDraft(e.target.value)}
        style={{ fontSize: 12, padding: 4 }}
        disabled={pending}
      />
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
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
      {error && (
        <p role="alert" style={{ color: "crimson", fontSize: 12, margin: 0 }}>
          {error}
        </p>
      )}
    </div>
  );
}
