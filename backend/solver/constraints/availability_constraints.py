from __future__ import annotations

from typing import Iterable, Mapping, Sequence, Tuple

from ortools.sat.python import cp_model

from constraints.result import ConstraintBuildResult
from model.entities import SlotRef


TeacherCoverMap = Mapping[Tuple[str, int, int], Sequence[cp_model.IntVar]]


from model.diagnostics import Diagnostic

def add_teacher_availability_constraints(
    *,
    model: cp_model.CpModel,
    teacher_covers: TeacherCoverMap,
    availability_by_faculty: Mapping[str, Iterable[SlotRef]],
    days_per_week: int,
    hours_per_day: int,
    break_hours_set: Iterable[int],
) -> ConstraintBuildResult:
    """
    Enforce hard teacher unavailability by banning all assignments covering
    unavailable teaching slots for each faculty member.
    """
    break_hours = set(break_hours_set)
    constraints_added = 0
    unavailable_cover_count = 0
    ignored_slots = 0

    for faculty_id, unavailable_slots in availability_by_faculty.items():
        seen: set[Tuple[int, int]] = set()
        for slot in unavailable_slots:
            key = (slot.day, slot.hour)
            if key in seen:
                continue
            seen.add(key)

            if (
                slot.day < 0
                or slot.day >= days_per_week
                or slot.hour < 0
                or slot.hour >= hours_per_day
                or slot.hour in break_hours
            ):
                ignored_slots += 1
                continue

            vars_here = list(teacher_covers.get((faculty_id, slot.day, slot.hour), ()))
            if not vars_here:
                continue

            model.Add(sum(vars_here) == 0)
            constraints_added += 1
            unavailable_cover_count += len(vars_here)

    diagnostics = []
    if unavailable_cover_count:
        diagnostics.append(
            Diagnostic(
                severity="info",
                code="AVAILABILITY_CONSTRAINTS_APPLIED",
                message=f"Teacher availability removed {unavailable_cover_count} candidate assignment covers."
            )
        )
    if ignored_slots:
        diagnostics.append(
            Diagnostic(
                severity="info",
                code="AVAILABILITY_SLOTS_IGNORED",
                message=f"Teacher availability ignored {ignored_slots} unavailable non-teaching slots."
            )
        )

    return ConstraintBuildResult(
        constraints_added=constraints_added,
        diagnostics=diagnostics,
    )

