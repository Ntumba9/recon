// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FindingRow } from "@/app/findings/FindingRow";

// Reliably forcing a 409 or a dropped connection against the real route
// means racing a second real mutation or killing the network mid-request -
// both are slow and flaky in the browser e2e suite (e2e/flows.spec.ts),
// which already covers the success and forbidden-origin paths against the
// real server. A mocked fetch gives deterministic, fast coverage of the
// two client-side branches a real browser run can't reliably trigger.

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

const baseProps = {
  id: "finding_1",
  mismatchClass: "AMOUNT_MISMATCH",
  severity: "CRITICAL",
  status: "OPEN" as const,
  orderReference: "ord_1",
  providerPaymentId: "pay_1",
  amountMinor: 1000,
  currency: "ZAR",
  firstSeenRunId: "run_1",
  lastSeenRunId: "run_1",
  note: null,
  evidence: {},
  columnCount: 7,
};

async function openDetailsAndAcknowledge() {
  fireEvent.click(screen.getByRole("button", { name: "Details" }));
  fireEvent.click(screen.getByRole("button", { name: "Acknowledge" }));
}

describe("FindingRow", () => {
  beforeEach(() => {
    refresh.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows the state-changed message and refreshes on a 409, without claiming success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({ error: "invalid_transition", message: "already changed" }),
      }),
    );

    render(<FindingRow {...baseProps} />);
    await openDetailsAndAcknowledge();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("This finding changed since the page loaded. Refreshed to the current state.");
    expect(screen.queryByText("Saved.")).not.toBeInTheDocument();
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it("shows a network-error message and does not refresh when fetch itself rejects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

    render(<FindingRow {...baseProps} />);
    await openDetailsAndAcknowledge();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Network error - could not reach the app.");
    expect(refresh).not.toHaveBeenCalled();
  });
});
