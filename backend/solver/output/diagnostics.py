from __future__ import annotations

from typing import Any, Dict

from model.entities import NormalizedSolverInput


def build_solver_diagnostics(
    payload: Dict[str, Any] | NormalizedSolverInput,
    result: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Compact solver diagnostics for logs and debugging surfaces.
    """
    if isinstance(payload, NormalizedSolverInput):
        summary = payload.summary()
        counts = summary["counts"]
        schedule = summary["schedule"]
    else:
        counts = {
            "classes": len(payload.get("classes") or []),
            "subjects": len(payload.get("subjects") or []),
            "faculties": len(payload.get("faculties") or []),
            "combos": len(payload.get("combos") or []),
            "fixedSlots": len(payload.get("fixedSlots") or []),
        }
        schedule = {
            "daysPerWeek": payload.get("DAYS_PER_WEEK"),
            "hoursPerDay": payload.get("HOURS_PER_DAY"),
        }

    return {
        "input": {
            **counts,
        },
        "schedule": schedule,
        "solver": {
            "ok": bool(result.get("ok")),
            "error": result.get("error"),
            "status": (result.get("solver_stats") or {}).get("status"),
            "objective_value": result.get("objective_value"),
        },
    }
