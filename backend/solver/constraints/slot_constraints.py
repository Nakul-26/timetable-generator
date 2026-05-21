from __future__ import annotations

from typing import Any, Callable, Dict, Iterable, List, Mapping, Sequence, Tuple

from ortools.sat.python import cp_model

from constraints.result import ConstraintBuildResult


CoverMap = Mapping[Tuple[str, int, int], Sequence[cp_model.IntVar]]


def add_class_slot_exclusivity(
    *,
    model: cp_model.CpModel,
    classes: Sequence[Dict[str, Any]],
    covers: CoverMap,
    hours_per_day: int,
    break_hours_set: Iterable[int],
    class_days_per_week: Callable[[Dict[str, Any]], int],
) -> ConstraintBuildResult:
    constraints_added = 0
    break_hours = set(break_hours_set)
    for cls in classes:
        class_id = cls["_id"]
        for day in range(class_days_per_week(cls)):
            for hour in range(hours_per_day):
                if hour in break_hours:
                    continue
                vars_here = list(covers.get((class_id, day, hour), ()))
                if vars_here:
                    model.AddAtMostOne(vars_here)
                    constraints_added += 1
    return ConstraintBuildResult(constraints_added=constraints_added)


def add_teacher_slot_exclusivity(
    *,
    model: cp_model.CpModel,
    faculty_ids: Sequence[str],
    teacher_covers: CoverMap,
    days_per_week: int,
    hours_per_day: int,
    break_hours_set: Iterable[int],
) -> ConstraintBuildResult:
    constraints_added = 0
    break_hours = set(break_hours_set)
    for faculty_id in faculty_ids:
        for day in range(days_per_week):
            for hour in range(hours_per_day):
                if hour in break_hours:
                    continue
                vars_here = list(teacher_covers.get((faculty_id, day, hour), ()))
                if vars_here:
                    model.AddAtMostOne(vars_here)
                    constraints_added += 1
    return ConstraintBuildResult(constraints_added=constraints_added)


def build_class_occupancy_vars(
    *,
    model: cp_model.CpModel,
    classes: Sequence[Dict[str, Any]],
    covers: CoverMap,
    hours_per_day: int,
    break_hours_set: Iterable[int],
    class_days_per_week: Callable[[Dict[str, Any]], int],
) -> Tuple[Dict[Tuple[str, int, int], cp_model.IntVar], ConstraintBuildResult]:
    class_occ: Dict[Tuple[str, int, int], cp_model.IntVar] = {}
    constraints_added = 0
    break_hours = set(break_hours_set)
    for cls in classes:
        class_id = cls["_id"]
        for day in range(class_days_per_week(cls)):
            for hour in range(hours_per_day):
                if hour in break_hours:
                    continue
                occ = model.NewBoolVar(f"class_occ_{class_id}_{day}_{hour}")
                vars_here = list(covers.get((class_id, day, hour), ()))
                if vars_here:
                    model.Add(occ == sum(vars_here))
                else:
                    model.Add(occ == 0)
                constraints_added += 1
                class_occ[(class_id, day, hour)] = occ
    return class_occ, ConstraintBuildResult(
        constraints_added=constraints_added,
        variables_created=len(class_occ),
    )


def build_teacher_occupancy_vars(
    *,
    model: cp_model.CpModel,
    faculty_ids: Sequence[str],
    teacher_covers: CoverMap,
    days_per_week: int,
    hours_per_day: int,
    break_hours_set: Iterable[int],
) -> Tuple[Dict[Tuple[str, int, int], cp_model.IntVar], ConstraintBuildResult]:
    teacher_occ: Dict[Tuple[str, int, int], cp_model.IntVar] = {}
    constraints_added = 0
    break_hours = set(break_hours_set)
    for faculty_id in faculty_ids:
        for day in range(days_per_week):
            for hour in range(hours_per_day):
                if hour in break_hours:
                    continue
                occ = model.NewBoolVar(f"teacher_occ_{faculty_id}_{day}_{hour}")
                vars_here = list(teacher_covers.get((faculty_id, day, hour), ()))
                if vars_here:
                    model.Add(occ == sum(vars_here))
                else:
                    model.Add(occ == 0)
                constraints_added += 1
                teacher_occ[(faculty_id, day, hour)] = occ
    return teacher_occ, ConstraintBuildResult(
        constraints_added=constraints_added,
        variables_created=len(teacher_occ),
    )
