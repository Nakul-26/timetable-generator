from __future__ import annotations

from copy import deepcopy
from typing import Any, Dict, Iterable, List, Tuple

from model.entities import (
    ClassEntity,
    ComboEntity,
    FixedSlotEntity,
    NormalizedSolverInput,
    SlotRef,
    SubjectEntity,
    TeacherEntity,
)
from solver_common import DEFAULT_SOLVER_TIME_LIMIT_SEC, DEFAULT_SOLUTION_COUNT, _cfg_get


def _as_list(value: Any) -> list:
    if isinstance(value, list):
        return list(value)
    if value is None:
        return []
    return [value]


def _clean_id(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _to_int(value: Any, default: int = 0) -> int:
    try:
        if value is None or value == "":
            return default
        return int(value)
    except Exception:
        return default


def _to_float(value: Any, default: float = 0.0) -> float:
    try:
        if value is None or value == "":
            return default
        return float(value)
    except Exception:
        return default


def _normalize_break_hours(raw_break_hours: Any, hours_per_day: int) -> Tuple[int, ...]:
    break_hours: List[int] = []
    seen = set()
    for raw_hour in _as_list(raw_break_hours):
        hour = _to_int(raw_hour, -1)
        if hour < 0 or hour >= hours_per_day or hour in seen:
            continue
        seen.add(hour)
        break_hours.append(hour)
    return tuple(break_hours)


def _dedupe_preserve_order(values: Iterable[str]) -> Tuple[str, ...]:
    seen = set()
    out: List[str] = []
    for value in values:
        cleaned = _clean_id(value)
        if not cleaned or cleaned in seen:
            continue
        seen.add(cleaned)
        out.append(cleaned)
    return tuple(out)


def _normalize_slot_refs(raw_slots: Any) -> Tuple[SlotRef, ...]:
    slots = []
    for item in _as_list(raw_slots):
        if not isinstance(item, dict):
            continue
        day = _to_int(item.get("day"), -1)
        hour = _to_int(item.get("hour"), -1)
        if day < 0 or hour < 0:
            continue
        slots.append(SlotRef(day=day, hour=hour))
    return tuple(slots)


def _normalize_teacher(raw: Dict[str, Any]) -> TeacherEntity:
    teacher_id = _clean_id(raw.get("_id") or raw.get("id"))
    return TeacherEntity(
        id=teacher_id,
        name=str(raw.get("name") or teacher_id),
        unavailable_slots=_normalize_slot_refs(raw.get("unavailableSlots") or raw.get("unavailable_slots")),
        preferences=dict(raw.get("preferences") or {}),
        raw=dict(raw),
    )


def _normalize_subject(raw: Dict[str, Any]) -> SubjectEntity:
    subject_id = _clean_id(raw.get("_id") or raw.get("id"))
    return SubjectEntity(
        id=subject_id,
        name=str(raw.get("name") or subject_id),
        subject_type=str(raw.get("type") or raw.get("subject_type") or "theory").strip().lower() or "theory",
        hours_per_week=_to_int(raw.get("no_of_hours_per_week") or raw.get("hoursPerWeek"), 0),
        raw=dict(raw),
    )


def _normalize_subject_id(raw: Dict[str, Any]) -> str:
    subject_ref = raw.get("subject")
    if isinstance(subject_ref, dict):
        return _clean_id(
            subject_ref.get("_id")
            or subject_ref.get("id")
            or subject_ref.get("subject_id")
            or subject_ref.get("subjectId")
        )
    return _clean_id(raw.get("subject_id") or raw.get("subjectId") or subject_ref)


def _normalize_class(raw: Dict[str, Any]) -> ClassEntity:
    class_id = _clean_id(raw.get("_id") or raw.get("id"))
    subject_hours_raw = raw.get("subject_hours")
    subject_hours: Dict[str, int] = {}
    if isinstance(subject_hours_raw, dict):
        for subject_id, hours in subject_hours_raw.items():
            cleaned_subject_id = _clean_id(subject_id)
            if not cleaned_subject_id:
                continue
            subject_hours[cleaned_subject_id] = max(0, _to_int(hours, 0))

    assigned_combos_raw = raw.get("assigned_teacher_subject_combos") or raw.get("assignedTeacherSubjectCombos")
    faculties_raw = raw.get("faculties") or raw.get("faculty_ids") or raw.get("facultyIds")

    return ClassEntity(
        id=class_id,
        name=str(raw.get("name") or class_id),
        days_per_week=max(1, _to_int(raw.get("days_per_week") or raw.get("daysPerWeek"), 0) or 0),
        subject_hours=subject_hours,
        assigned_teacher_subject_combos=_dedupe_preserve_order(_as_list(assigned_combos_raw)),
        faculties=_dedupe_preserve_order(_as_list(faculties_raw)),
        raw=dict(raw),
    )


def _normalize_combo(raw: Dict[str, Any]) -> ComboEntity:
    combo_id = _clean_id(raw.get("_id") or raw.get("id"))
    class_ids_raw = raw.get("class_ids") or raw.get("classIds") or raw.get("class_id") or raw.get("classId") or raw.get("classes")
    faculty_ids_raw = raw.get("faculty_ids") or raw.get("facultyIds") or raw.get("faculty_id") or raw.get("facultyId") or raw.get("teachers") or raw.get("teacher_ids")
    subject_id = _normalize_subject_id(raw)

    return ComboEntity(
        id=combo_id,
        subject_id=subject_id,
        faculty_ids=_dedupe_preserve_order(_as_list(faculty_ids_raw)),
        class_ids=_dedupe_preserve_order(_as_list(class_ids_raw)),
        raw=dict(raw),
    )


def _normalize_fixed_slot(raw: Dict[str, Any]) -> FixedSlotEntity:
    return FixedSlotEntity(
        class_id=_clean_id(raw.get("class") or raw.get("classId")),
        combo_id=_clean_id(raw.get("combo") or raw.get("comboId")),
        day=_to_int(raw.get("day"), -1),
        hour=_to_int(raw.get("hour"), -1),
        raw=dict(raw),
    )


def normalize_solver_payload(payload: Dict[str, Any] | None) -> NormalizedSolverInput:
    """
    Canonicalize the raw API payload before it reaches the solver engine.

    This keeps the entrypoint stable even when callers send partially-shaped
    payloads or omit defaults that the solver expects.
    """
    raw = deepcopy(payload or {})
    warnings: List[str] = []

    classes_raw = _as_list(raw.get("classes"))
    subjects_raw = _as_list(raw.get("subjects"))
    faculties_raw = _as_list(raw.get("faculties"))
    combos_raw = _as_list(raw.get("combos"))
    fixed_slots_raw = _as_list(raw.get("fixedSlots"))

    constraint_config = raw.get("constraintConfig")
    if not isinstance(constraint_config, dict):
        constraint_config = {}

    days_per_week = max(
        1,
        _to_int(raw.get("DAYS_PER_WEEK") or _cfg_get(constraint_config, ["schedule", "daysPerWeek"], 6), 6),
    )
    hours_per_day = max(
        1,
        _to_int(raw.get("HOURS_PER_DAY") or _cfg_get(constraint_config, ["schedule", "hoursPerDay"], 8), 8),
    )
    break_hours = _normalize_break_hours(
        _cfg_get(constraint_config, ["schedule", "breakHours"], raw.get("BREAK_HOURS") or []),
        hours_per_day,
    )
    solution_count = max(
        1,
        min(
            5,
            _to_int(
                raw.get("solutionCount")
                or _cfg_get(constraint_config, ["solver", "solutionCount"], DEFAULT_SOLUTION_COUNT),
                DEFAULT_SOLUTION_COUNT,
            ),
        ),
    )
    solver_time_limit_sec = max(
        1.0,
        _to_float(
            raw.get("solver_time_limit_sec")
            or _cfg_get(constraint_config, ["solver", "timeLimitSec"], DEFAULT_SOLVER_TIME_LIMIT_SEC),
            DEFAULT_SOLVER_TIME_LIMIT_SEC,
        ),
    )

    teachers = tuple(_normalize_teacher(item) for item in faculties_raw if isinstance(item, dict))
    subjects = tuple(_normalize_subject(item) for item in subjects_raw if isinstance(item, dict))
    classes = tuple(_normalize_class(item) for item in classes_raw if isinstance(item, dict))
    combos = tuple(_normalize_combo(item) for item in combos_raw if isinstance(item, dict))
    fixed_slots = tuple(_normalize_fixed_slot(item) for item in fixed_slots_raw if isinstance(item, dict))

    if not classes:
        warnings.append("No classes were supplied to the solver.")
    if not subjects:
        warnings.append("No subjects were supplied to the solver.")
    if not teachers:
        warnings.append("No faculties were supplied to the solver.")

    for combo in combos:
        if not combo.subject_id:
            warnings.append(f"Combo {combo.id or '<missing>'} has no subject id and may be ignored.")
        if not combo.class_ids:
            warnings.append(f"Combo {combo.id or '<missing>'} has no class ids and may be ignored.")

    for class_entity in classes:
        if not class_entity.assigned_teacher_subject_combos:
            warnings.append(
                f"Class {class_entity.name or class_entity.id or '<missing>'} has no assigned teacher-subject combos."
            )

    normalized_mode = str(raw.get("mode") or "college").strip() or "college"
    input_mode = str(raw.get("inputMode") or "EXPLICIT").strip().upper() or "EXPLICIT"

    return NormalizedSolverInput(
        classes=classes,
        subjects=subjects,
        faculties=teachers,
        combos=combos,
        fixed_slots=fixed_slots,
        constraint_config=constraint_config,
        days_per_week=days_per_week,
        hours_per_day=hours_per_day,
        break_hours=break_hours,
        solution_count=solution_count,
        solver_time_limit_sec=solver_time_limit_sec,
        input_mode=input_mode,
        mode=normalized_mode,
        warnings=tuple(warnings),
        raw=raw,
    )
