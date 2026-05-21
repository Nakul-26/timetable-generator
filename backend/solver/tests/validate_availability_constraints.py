from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from ortools.sat.python import cp_model

from constraints.availability_constraints import add_teacher_availability_constraints
from model.entities import SlotRef


def main() -> int:
    model = cp_model.CpModel()
    x1 = model.NewBoolVar("x1")
    x2 = model.NewBoolVar("x2")
    x3 = model.NewBoolVar("x3")

    result = add_teacher_availability_constraints(
        model=model,
        teacher_covers={
            ("teach-1", 0, 1): [x1, x2],
            ("teach-1", 0, 2): [x3],
        },
        availability_by_faculty={
            "teach-1": (
                SlotRef(day=0, hour=1),
                SlotRef(day=0, hour=1),
                SlotRef(day=0, hour=0),
                SlotRef(day=7, hour=1),
            ),
            "teach-2": (SlotRef(day=0, hour=1),),
        },
        days_per_week=5,
        hours_per_day=4,
        break_hours_set={0},
    )

    if result.constraints_added != 1:
        print(f"Expected 1 availability constraint, got {result.constraints_added}")
        return 1
    if result.variables_created != 0:
        print(f"Expected no variables created, got {result.variables_created}")
        return 1
    actual_diagnostics = [d.message for d in result.diagnostics]
    expected_diagnostics = [
        "Teacher availability removed 2 candidate assignment covers.",
        "Teacher availability ignored 2 unavailable non-teaching slots.",
    ]
    if actual_diagnostics != expected_diagnostics:
        print(f"Expected diagnostics {expected_diagnostics}, got {actual_diagnostics}")
        return 1
    if len(model.Proto().constraints) != 1:
        print(f"Expected 1 model constraint, got {len(model.Proto().constraints)}")
        return 1

    print("OK: availability constraints")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
