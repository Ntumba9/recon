"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface RunResult {
  status: "SUCCESS" | "INCONCLUSIVE" | "FAILED";
  findingCount: number;
  notes: string | null;
}

/**
 * Triggers a reconciliation run through POST /api/runs. Loading, error, and
 * result states are all shown honestly: a FAILED or INCONCLUSIVE result is
 * never hidden or rephrased as success. The button disables itself while a
 * request is pending, and the server also rejects a second concurrent
 * trigger (see src/app/api/runs/route.ts), so a double-click can't start
 * two overlapping runs.
 */
export function RunTrigger({ initialDisabled }: { initialDisabled: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);

  async function trigger() {
    setPending(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/runs", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(
          data.error === "run_in_progress"
            ? "A reconciliation run is already in progress. Try again once it finishes."
            : `Could not start the run (${data.error ?? res.status}).`
        );
        return;
      }
      setResult({ status: data.status, findingCount: data.findingCount, notes: data.notes ?? null });
      router.refresh();
    } catch {
      setError("Network error - could not reach the app.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div style={{ marginBottom: 24 }}>
      <button type="button" disabled={pending || initialDisabled} onClick={trigger}>
        {pending ? "Running..." : "Run reconciliation"}
      </button>
      {initialDisabled && !pending && !result && (
        <p style={{ color: "#555", marginTop: 8 }}>A run is already in progress - refresh to check.</p>
      )}
      {error && <p style={{ color: "crimson", marginTop: 8 }}>{error}</p>}
      {result && (
        <p style={{ marginTop: 8 }}>
          Run finished: <strong>{result.status}</strong> - {result.findingCount} finding(s)
          {result.notes ? ` (${result.notes})` : ""}
        </p>
      )}
    </div>
  );
}
