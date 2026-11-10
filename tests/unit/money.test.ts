import { describe, expect, it } from "vitest";
import { addMoney, formatMoney, money, moneyEquals } from "@/lib/money";

describe("money", () => {
  it("requires an integer amount", () => {
    expect(() => money(10.5, "USD")).toThrow(TypeError);
  });

  it("requires a currency", () => {
    expect(() => money(100, "")).toThrow(TypeError);
  });

  it("normalizes currency to uppercase", () => {
    expect(money(100, "usd").currency).toBe("USD");
  });

  it("compares amount and currency for equality", () => {
    expect(moneyEquals(money(100, "USD"), money(100, "USD"))).toBe(true);
    expect(moneyEquals(money(100, "USD"), money(100, "ZAR"))).toBe(false);
    expect(moneyEquals(money(100, "USD"), money(101, "USD"))).toBe(false);
  });

  it("adds money of the same currency", () => {
    expect(addMoney(money(100, "USD"), money(50, "USD"))).toEqual(money(150, "USD"));
  });

  it("refuses to add mismatched currencies", () => {
    expect(() => addMoney(money(100, "USD"), money(50, "ZAR"))).toThrow(/mismatched currencies/);
  });

  it("formats minor units as a major-unit string", () => {
    expect(formatMoney(money(123456, "ZAR"))).toBe("ZAR 1234.56");
  });
});
