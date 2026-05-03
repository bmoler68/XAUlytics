"""Pure helpers for environment-based configuration (no I/O)."""
from __future__ import annotations


def parse_base_currencies(raw: str | None) -> tuple[str, ...]:
    """Comma-separated ISO codes, order preserved, deduplicated. Empty → USD only."""
    if not raw or not raw.strip():
        return ("USD",)
    out: list[str] = []
    seen: set[str] = set()
    for part in raw.split(","):
        code = part.strip().upper()
        if not code or code in seen:
            continue
        seen.add(code)
        out.append(code)
    return tuple(out) if out else ("USD",)
