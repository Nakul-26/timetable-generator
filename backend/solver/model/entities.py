from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Mapping, Tuple


@dataclass(frozen=True)
class SlotRef:
    day: int
    hour: int


@dataclass(frozen=True)
class TeacherEntity:
    id: str
    name: str
    unavailable_slots: Tuple[SlotRef, ...] = ()
    preferences: Dict[str, Any] = field(default_factory=dict)
    raw: Dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class SubjectEntity:
    id: str
    name: str
    subject_type: str = "theory"
    hours_per_week: int = 0
    raw: Dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ClassEntity:
    id: str
    name: str
    days_per_week: int
    subject_hours: Dict[str, int] = field(default_factory=dict)
    assigned_teacher_subject_combos: Tuple[str, ...] = ()
    faculties: Tuple[str, ...] = ()
    raw: Dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ComboEntity:
    id: str
    subject_id: str
    faculty_ids: Tuple[str, ...]
    class_ids: Tuple[str, ...]
    raw: Dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class FixedSlotEntity:
    class_id: str
    combo_id: str
    day: int
    hour: int
    raw: Dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ComboCandidateInfo:
    combo_id: str
    subject_id: str
    class_ids: Tuple[str, ...]
    faculty_ids: Tuple[str, ...]
    block_size: int
    is_lab: bool
    max_days: int
    candidate_starts: Tuple[SlotRef, ...]
    required_hours_by_class: Mapping[str, int]
    rejected_break_starts: int = 0
    rejected_overflow_starts: int = 0
    rejected_split_break_starts: int = 0


@dataclass(frozen=True)
class VariablePreparationContext:
    combo_candidate_starts: Mapping[str, Tuple[SlotRef, ...]]
    combo_search_rank: Mapping[str, int]
    class_slot_pressure: Mapping[Tuple[str, int, int], int]
    teacher_slot_pressure: Mapping[Tuple[str, int, int], int]
    sorted_combo_ids: Tuple[str, ...]
    ordered_starts_by_combo: Mapping[str, Tuple[SlotRef, ...]]


@dataclass(frozen=True)
class NormalizedSolverInput:
    classes: Tuple[ClassEntity, ...]
    subjects: Tuple[SubjectEntity, ...]
    faculties: Tuple[TeacherEntity, ...]
    combos: Tuple[ComboEntity, ...]
    fixed_slots: Tuple[FixedSlotEntity, ...]
    constraint_config: Dict[str, Any]
    days_per_week: int
    hours_per_day: int
    break_hours: Tuple[int, ...]
    solution_count: int
    solver_time_limit_sec: float
    input_mode: str
    mode: str
    warnings: Tuple[str, ...] = ()
    raw: Dict[str, Any] = field(default_factory=dict)

    def to_payload(self) -> Dict[str, Any]:
        return {
            **self.raw,
            "classes": [
                {
                    **entity.raw,
                    "_id": entity.id,
                    "name": entity.name,
                    "days_per_week": entity.days_per_week,
                    "subject_hours": dict(entity.subject_hours),
                    "assigned_teacher_subject_combos": list(entity.assigned_teacher_subject_combos),
                    "faculties": list(entity.faculties),
                }
                for entity in self.classes
            ],
            "subjects": [
                {
                    **entity.raw,
                    "_id": entity.id,
                    "name": entity.name,
                    "type": entity.subject_type,
                    "no_of_hours_per_week": entity.hours_per_week,
                }
                for entity in self.subjects
            ],
            "faculties": [
                {
                    **entity.raw,
                    "_id": entity.id,
                    "name": entity.name,
                    "unavailableSlots": [
                        {"day": slot.day, "hour": slot.hour} for slot in entity.unavailable_slots
                    ],
                    "preferences": dict(entity.preferences),
                }
                for entity in self.faculties
            ],
            "combos": [
                {
                    **entity.raw,
                    "_id": entity.id,
                    "subject_id": entity.subject_id,
                    "faculty_ids": list(entity.faculty_ids),
                    "class_ids": list(entity.class_ids),
                }
                for entity in self.combos
            ],
            "fixedSlots": [
                {
                    **entity.raw,
                    "class": entity.class_id,
                    "combo": entity.combo_id,
                    "day": entity.day,
                    "hour": entity.hour,
                }
                for entity in self.fixed_slots
            ],
            "constraintConfig": dict(self.constraint_config),
            "DAYS_PER_WEEK": self.days_per_week,
            "HOURS_PER_DAY": self.hours_per_day,
            "BREAK_HOURS": list(self.break_hours),
            "solutionCount": self.solution_count,
            "solver_time_limit_sec": self.solver_time_limit_sec,
            "inputMode": self.input_mode,
            "mode": self.mode,
        }

    def summary(self) -> Dict[str, Any]:
        return {
            "counts": {
                "classes": len(self.classes),
                "subjects": len(self.subjects),
                "faculties": len(self.faculties),
                "combos": len(self.combos),
                "fixedSlots": len(self.fixed_slots),
            },
            "schedule": {
                "daysPerWeek": self.days_per_week,
                "hoursPerDay": self.hours_per_day,
                "breakHours": list(self.break_hours),
            },
            "solver": {
                "solutionCount": self.solution_count,
                "timeLimitSec": self.solver_time_limit_sec,
            },
            "warnings": list(self.warnings),
        }
