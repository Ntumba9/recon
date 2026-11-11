"""ISO 8601 UTC timestamp helpers. Every timestamp RECON produces or reads is
UTC with millisecond precision (JavaScript's Date#toISOString() shape), so
parsing and formatting both standardize on that exact shape for parity."""

from datetime import datetime, timezone


def parse_iso_to_ms(timestamp: str) -> int:
    """Parses an ISO 8601 UTC timestamp (e.g. "2026-01-01T00:00:00.000Z") to
    milliseconds since the epoch - the same unit used throughout evidence
    fields like ageMs/ageSinceUpdateMs, to match the TypeScript engine."""
    normalized = timestamp[:-1] + "+00:00" if timestamp.endswith("Z") else timestamp
    dt = datetime.fromisoformat(normalized)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return round(dt.timestamp() * 1000)


def ms_to_iso(ms: int) -> str:
    dt = datetime.fromtimestamp(ms / 1000, tz=timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def now_iso() -> str:
    dt = datetime.now(timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"
