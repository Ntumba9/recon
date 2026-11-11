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
 */
export function FindingActions({ id, status }: { id: string; status: Status }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState("");

  async function transition(nextStatus: Status) {
    setPending(true);
    try {
      const res = await fetch(`/api/findings/${id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus, note: note.trim() || undefined }),
      });
      if (res.ok) {
        setNote("");
        router.refresh();
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 160 }}>
      <input
        type="text"
        placeholder="Note (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        style={{ fontSize: 12, padding: 4 }}
        disabled={pending}
      />
      <div style={{ display: "flex", gap: 6 }}>
        {NEXT_ACTIONS[status].map((action) => (
          <button key={action.status} type="button" disabled={pending} onClick={() => transition(action.status)}>
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}
