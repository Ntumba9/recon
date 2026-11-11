"""Deterministic finding identity, byte-for-byte identical to
src/core/reconciler/findingKey.ts: sha256 of the mismatch class plus its
natural keys, joined with "|" (missing parts as empty string), first 32 hex
characters. Built only from natural keys (never a run id or timestamp), so
the same underlying discrepancy produces the same key on every run - and,
since both engines hash the same material the same way, the same key in
both languages too."""

import hashlib
from typing import Optional


def build_finding_key(mismatch_class: str, *parts: Optional[str]) -> str:
    material = "|".join([mismatch_class] + [p or "" for p in parts])
    return hashlib.sha256(material.encode("utf-8")).hexdigest()[:32]
