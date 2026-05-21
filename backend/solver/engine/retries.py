from __future__ import annotations

from typing import Any, Callable


def solve_with_retries(
    solve_fn: Callable[[dict[str, Any]], dict[str, Any]],
    payload: dict[str, Any],
    attempts: int = 1,
) -> dict[str, Any]:
    """
    Minimal retry wrapper around the authoritative solver engine.

    The first stabilization phase keeps this intentionally conservative.
    """
    last_error: Exception | None = None
    for _ in range(max(1, int(attempts))):
        try:
            return solve_fn(payload)
        except Exception as exc:  # pragma: no cover - solver failures are runtime-dependent
            last_error = exc
    if last_error is not None:
        raise last_error
    return solve_fn(payload)
