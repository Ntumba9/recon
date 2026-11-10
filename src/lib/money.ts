/**
 * Money is always an integer amount in minor units (cents) paired with an
 * explicit ISO currency code. Never floats - floating point amounts are
 * exactly the kind of silent rounding bug a reconciliation tool exists to
 * catch, not introduce.
 */
export interface Money {
  readonly amountMinor: number;
  readonly currency: string;
}

export function money(amountMinor: number, currency: string): Money {
  if (!Number.isInteger(amountMinor)) {
    throw new TypeError(`amountMinor must be an integer, got ${amountMinor}`);
  }
  if (!currency || currency.trim().length === 0) {
    throw new TypeError("currency is required");
  }
  return { amountMinor, currency: currency.toUpperCase() };
}

export function moneyEquals(a: Money, b: Money): boolean {
  return a.amountMinor === b.amountMinor && a.currency === b.currency;
}

export function sameCurrency(a: Money, b: Money): boolean {
  return a.currency === b.currency;
}

export function addMoney(a: Money, b: Money): Money {
  if (!sameCurrency(a, b)) {
    throw new Error(`Cannot add mismatched currencies: ${a.currency} vs ${b.currency}`);
  }
  return money(a.amountMinor + b.amountMinor, a.currency);
}

export function formatMoney(m: Money): string {
  const major = m.amountMinor / 100;
  return `${m.currency} ${major.toFixed(2)}`;
}
