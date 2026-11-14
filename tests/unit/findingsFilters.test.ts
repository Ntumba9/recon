import { describe, expect, it } from "vitest";
import { parseFindingsSearchParams } from "@/app/findings/filters";

describe("parseFindingsSearchParams", () => {
  it("defaults to no filters and page 1", () => {
    const parsed = parseFindingsSearchParams({});
    expect(parsed).toMatchObject({ classFilter: undefined, severityFilter: undefined, statusFilter: undefined, page: 1 });
  });

  it("accepts a valid class/severity/status", () => {
    const parsed = parseFindingsSearchParams({ class: "AGED_PENDING_BOOKING", severity: "CRITICAL", status: "OPEN" });
    expect(parsed.classFilter).toBe("AGED_PENDING_BOOKING");
    expect(parsed.severityFilter).toBe("CRITICAL");
    expect(parsed.statusFilter).toBe("OPEN");
  });

  it("falls back an unknown class value to All (undefined), not an error or a dead filter", () => {
    const parsed = parseFindingsSearchParams({ class: "NOT_A_REAL_CLASS" });
    expect(parsed.classFilter).toBeUndefined();
  });

  it("falls back an unknown severity value to All", () => {
    const parsed = parseFindingsSearchParams({ severity: "URGENT" });
    expect(parsed.severityFilter).toBeUndefined();
  });

  it("falls back an unknown status value to All", () => {
    const parsed = parseFindingsSearchParams({ status: "DONE" });
    expect(parsed.statusFilter).toBeUndefined();
  });

  it("clamps page to at least 1 for zero, negative, or non-numeric input", () => {
    expect(parseFindingsSearchParams({ page: "0" }).page).toBe(1);
    expect(parseFindingsSearchParams({ page: "-5" }).page).toBe(1);
    expect(parseFindingsSearchParams({ page: "not-a-number" }).page).toBe(1);
  });

  it("caps pageSize at the maximum", () => {
    expect(parseFindingsSearchParams({ pageSize: "1000" }).pageSize).toBe(100);
  });
});
