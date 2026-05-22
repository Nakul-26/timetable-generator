from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from ortools.sat.python import cp_model

from constraints.fixed_slot_constraints import add_fixed_slot_constraints


def main() -> int:
    model = cp_model.CpModel()
    x1 = model.NewBoolVar("x_combo_1_0_1")

    result, diagnostics = add_fixed_slot_constraints(
        model=model,
        fixed_slots=[
            {"class": "class-1", "combo": "combo-1", "day": 0, "hour": 1},
            {"class": "class-1", "combo": "combo-2", "day": 0, "hour": 2},
        ],
        assignment_vars={
            ("combo-1", 0, 1): x1,
        },
    )

    if result.constraints_added != 2:
        print(f"Expected 2 fixed-slot constraints, got {result.constraints_added}")
        return 1
    
    actual_warnings = [d.message for d in diagnostics]
    expected_warnings = [
        "Fixed slot invalid for class class-1 combo combo-2 at Day 0, Hour 2. No solver variable exists for this placement.",
    ]
    if actual_warnings != expected_warnings:
        print(f"Expected warnings {expected_warnings}, got {actual_warnings}")
        return 1
    
    actual_diagnostics = [d.message for d in result.diagnostics]
    expected_diagnostics = [
        "Fixed slots enforced 1 required assignments.",
        "Fixed slots had 1 slots without candidate variables; generation is infeasible until they are corrected.",
    ]
    if actual_diagnostics != expected_diagnostics:
        print(f"Expected diagnostics {expected_diagnostics}, got {actual_diagnostics}")
        return 1
    if len(model.Proto().constraints) != 2:
        print(f"Expected 2 model constraints, got {len(model.Proto().constraints)}")
        return 1

    solver = cp_model.CpSolver()
    status = solver.Solve(model)
    if status != cp_model.INFEASIBLE:
        print("Expected missing fixed variable to make the model infeasible")
        return 1

    cover_model = cp_model.CpModel()
    start_at_1 = cover_model.NewBoolVar("x_lab_0_1")
    cover_result, cover_diagnostics = add_fixed_slot_constraints(
        model=cover_model,
        fixed_slots=[
            {"class": "class-1", "combo": "lab-combo", "day": 0, "hour": 2},
        ],
        cover_vars={
            ("lab-combo", 0, 2): [start_at_1],
        },
    )
    if cover_result.constraints_added != 1 or cover_diagnostics:
        print("Expected cover-based fixed slot to add one clean constraint")
        return 1
    cover_solver = cp_model.CpSolver()
    cover_status = cover_solver.Solve(cover_model)
    if cover_status not in (cp_model.OPTIMAL, cp_model.FEASIBLE) or cover_solver.Value(start_at_1) != 1:
        print("Expected covered fixed slot to force its covering variable")
        return 1

    print("OK: fixed slot constraints")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
