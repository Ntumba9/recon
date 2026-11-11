"""Money is always an integer amount in minor units (cents) paired with an
explicit currency code. Never floats - the same rule as src/lib/money.ts,
for the same reason: floating point amounts are exactly the kind of silent
rounding bug a reconciliation tool exists to catch, not introduce."""


def validate_money(amount_minor: int, currency: str) -> None:
    if not isinstance(amount_minor, int) or isinstance(amount_minor, bool):
        raise TypeError(f"amount_minor must be an integer, got {amount_minor!r}")
    if not currency or not currency.strip():
        raise TypeError("currency is required")


def normalize_currency(currency: str) -> str:
    return currency.strip().upper()


def format_money(amount_minor: int, currency: str) -> str:
    major = amount_minor / 100
    return f"{currency} {major:.2f}"
