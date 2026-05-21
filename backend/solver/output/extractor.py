from __future__ import annotations

from copy import deepcopy
from typing import Any, Dict

from output.diagnostics import build_solver_stats
from model.entities import NormalizedSolverInput


def extract_solver_result(result: Dict[str, Any] | None, payload: Dict[str, Any] | NormalizedSolverInput | None = None) -> Dict[str, Any]:
    """
    Normalize the solver response into a stable API contract.
    """
    normalized = deepcopy(result or {})
    if payload is not None:
        normalized.setdefault("stats", build_solver_stats(payload, normalized))
    
    # Ensure diagnostics is always a list
    if "diagnostics" not in normalized or not isinstance(normalized["diagnostics"], list):
        normalized["diagnostics"] = []
        
    return normalized
