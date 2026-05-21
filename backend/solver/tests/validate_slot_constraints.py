from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from ortools.sat.python import cp_model

from constraints.slot_constraints import (
    add_class_slot_exclusivity,
    add_teacher_slot_exclusivity,
    build_class_occupancy_vars,
    build_teacher_occupancy_vars,
)


def main() -> int:
    model = cp_model.CpModel()
    classes = [{"_id": "class-1", "days_per_week": 2}]
    faculty_ids = ["teach-1"]
    class_days_per_week = lambda cls: int(cls["days_per_week"])

    x1 = model.NewBoolVar("x1")
    x2 = model.NewBoolVar("x2")
    x3 = model.NewBoolVar("x3")

    covers = {
        ("class-1", 0, 1): [x1, x2],
        ("class-1", 1, 2): [x3],
    }
    teacher_covers = {
        ("teach-1", 0, 1): [x1, x2],
    }

    class_slot_result = add_class_slot_exclusivity(
        model=model,
        classes=classes,
        covers=covers,
        hours_per_day=4,
        break_hours_set={0},
        class_days_per_week=class_days_per_week,
    )
    teacher_slot_result = add_teacher_slot_exclusivity(
        model=model,
        faculty_ids=faculty_ids,
        teacher_covers=teacher_covers,
        days_per_week=2,
        hours_per_day=4,
        break_hours_set={0},
    )
    class_occ, class_occ_result = build_class_occupancy_vars(
        model=model,
        classes=classes,
        covers=covers,
        hours_per_day=4,
        break_hours_set={0},
        class_days_per_week=class_days_per_week,
    )
    teacher_occ, teacher_occ_result = build_teacher_occupancy_vars(
        model=model,
        faculty_ids=faculty_ids,
        teacher_covers=teacher_covers,
        days_per_week=2,
        hours_per_day=4,
        break_hours_set={0},
    )

    if len(class_occ) != 6:
        print(f"Expected 6 class occupancy vars, got {len(class_occ)}")
        return 1
    if len(teacher_occ) != 6:
        print(f"Expected 6 teacher occupancy vars, got {len(teacher_occ)}")
        return 1
    if ("class-1", 0, 0) in class_occ:
        print("Break hour should not create class occupancy")
        return 1
    if ("teach-1", 0, 0) in teacher_occ:
        print("Break hour should not create teacher occupancy")
        return 1
    if class_slot_result.constraints_added != 2:
        print(f"Expected 2 class slot constraints, got {class_slot_result.constraints_added}")
        return 1
    if teacher_slot_result.constraints_added != 1:
        print(f"Expected 1 teacher slot constraint, got {teacher_slot_result.constraints_added}")
        return 1
    if class_occ_result.variables_created != 6 or class_occ_result.constraints_added != 6:
        print(f"Unexpected class occupancy result: {class_occ_result}")
        return 1
    if teacher_occ_result.variables_created != 6 or teacher_occ_result.constraints_added != 6:
        print(f"Unexpected teacher occupancy result: {teacher_occ_result}")
        return 1

    constraint_count = len(model.Proto().constraints)
    if constraint_count != 15:
        print(f"Expected 15 constraints, got {constraint_count}")
        return 1

    print("OK: slot constraints")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
