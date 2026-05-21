from __future__ import annotations

from dataclasses import dataclass
from types import MappingProxyType
from typing import Any, Dict, Iterable, Mapping, Tuple

from input.normalize import normalize_solver_payload
from model.entities import (
    ClassEntity,
    ComboCandidateInfo,
    ComboEntity,
    FixedSlotEntity,
    NormalizedSolverInput,
    SlotRef,
    SubjectEntity,
    VariablePreparationContext,
)


@dataclass(frozen=True)
class SolverModelContext:
    """
    Deterministic, read-only derived model state prepared before solving.

    This context owns reusable indexes and slot structures only. Constraint
    creation and optimization decisions stay in the solver engine.
    """

    input: NormalizedSolverInput
    combo_by_id: Mapping[str, ComboEntity]
    combos_by_class: Mapping[str, Tuple[ComboEntity, ...]]
    combos_by_faculty: Mapping[str, Tuple[ComboEntity, ...]]
    slots_by_day: Mapping[int, Tuple[SlotRef, ...]]
    teaching_slots: Tuple[SlotRef, ...]
    break_slots: Tuple[SlotRef, ...]
    fixed_slots_by_class: Mapping[str, Tuple[FixedSlotEntity, ...]]
    fixed_slots_by_faculty: Mapping[str, Tuple[FixedSlotEntity, ...]]
    availability_by_faculty: Mapping[str, Tuple[SlotRef, ...]]
    candidates_by_combo: Mapping[str, ComboCandidateInfo]


def build_solver_request(payload: Dict[str, Any] | None) -> NormalizedSolverInput:
    """
    Build the canonical solver request shape.

    Phase 1 keeps this thin so the entrypoint can become stable immediately.
    Later phases can move more normalization logic out of `solver_core.py`.
    """
    return normalize_solver_payload(payload)


def build_solver_model_context(input_data: NormalizedSolverInput) -> SolverModelContext:
    combo_by_id, combos_by_class, combos_by_faculty = build_combo_indexes(input_data)
    slots_by_day, teaching_slots, break_slots = build_slot_indexes(input_data)
    fixed_slots_by_class, fixed_slots_by_faculty = build_fixed_slot_indexes(
        input_data,
        combo_by_id,
    )
    availability_by_faculty = build_availability_indexes(input_data)
    candidates_by_combo = build_candidate_indexes(input_data, combo_by_id)

    return SolverModelContext(
        input=input_data,
        combo_by_id=combo_by_id,
        combos_by_class=combos_by_class,
        combos_by_faculty=combos_by_faculty,
        slots_by_day=slots_by_day,
        teaching_slots=teaching_slots,
        break_slots=break_slots,
        fixed_slots_by_class=fixed_slots_by_class,
        fixed_slots_by_faculty=fixed_slots_by_faculty,
        availability_by_faculty=availability_by_faculty,
        candidates_by_combo=candidates_by_combo,
    )


def build_combo_indexes(
    input_data: NormalizedSolverInput,
) -> Tuple[
    Mapping[str, ComboEntity],
    Mapping[str, Tuple[ComboEntity, ...]],
    Mapping[str, Tuple[ComboEntity, ...]],
]:
    combo_by_id = {combo.id: combo for combo in input_data.combos if combo.id}
    combos_by_class: Dict[str, list[ComboEntity]] = {}
    combos_by_faculty: Dict[str, list[ComboEntity]] = {}

    for combo in input_data.combos:
        for class_id in combo.class_ids:
            combos_by_class.setdefault(class_id, []).append(combo)
        for faculty_id in combo.faculty_ids:
            combos_by_faculty.setdefault(faculty_id, []).append(combo)

    return (
        _freeze_mapping(combo_by_id),
        _freeze_tuple_mapping(combos_by_class),
        _freeze_tuple_mapping(combos_by_faculty),
    )


def build_slot_indexes(
    input_data: NormalizedSolverInput,
) -> Tuple[Mapping[int, Tuple[SlotRef, ...]], Tuple[SlotRef, ...], Tuple[SlotRef, ...]]:
    break_hours = _break_hours(input_data)
    slots_by_day: Dict[int, list[SlotRef]] = {}
    teaching_slots: list[SlotRef] = []
    break_slots: list[SlotRef] = []

    for day in range(input_data.days_per_week):
        day_slots: list[SlotRef] = []
        for hour in range(input_data.hours_per_day):
            slot = SlotRef(day=day, hour=hour)
            day_slots.append(slot)
            if hour in break_hours:
                break_slots.append(slot)
            else:
                teaching_slots.append(slot)
        slots_by_day[day] = day_slots

    return (
        _freeze_tuple_mapping(slots_by_day),
        tuple(teaching_slots),
        tuple(break_slots),
    )


def build_fixed_slot_indexes(
    input_data: NormalizedSolverInput,
    combo_by_id: Mapping[str, ComboEntity] | None = None,
) -> Tuple[Mapping[str, Tuple[FixedSlotEntity, ...]], Mapping[str, Tuple[FixedSlotEntity, ...]]]:
    fixed_slots_by_class: Dict[str, list[FixedSlotEntity]] = {}
    fixed_slots_by_faculty: Dict[str, list[FixedSlotEntity]] = {}
    combo_lookup = combo_by_id or build_combo_indexes(input_data)[0]

    for fixed_slot in input_data.fixed_slots:
        if fixed_slot.class_id:
            fixed_slots_by_class.setdefault(fixed_slot.class_id, []).append(fixed_slot)

        combo = combo_lookup.get(fixed_slot.combo_id)
        if combo is None:
            continue
        for faculty_id in combo.faculty_ids:
            fixed_slots_by_faculty.setdefault(faculty_id, []).append(fixed_slot)

    return (
        _freeze_tuple_mapping(fixed_slots_by_class),
        _freeze_tuple_mapping(fixed_slots_by_faculty),
    )


def build_availability_indexes(
    input_data: NormalizedSolverInput,
) -> Mapping[str, Tuple[SlotRef, ...]]:
    global_slots = _config_slots(
        _cfg_get(input_data.constraint_config, ["teacherAvailability", "globallyUnavailableSlots"], [])
    )
    by_teacher_raw = _cfg_get(
        input_data.constraint_config,
        ["teacherAvailability", "unavailableSlotsByTeacher"],
        {},
    )
    if not isinstance(by_teacher_raw, dict):
        by_teacher_raw = {}

    availability_by_faculty: Dict[str, Tuple[SlotRef, ...]] = {}
    for faculty in input_data.faculties:
        merged = [
            *global_slots,
            *faculty.unavailable_slots,
            *_config_slots(by_teacher_raw.get(faculty.id)),
        ]
        availability_by_faculty[faculty.id] = _dedupe_slots(merged)

    return _freeze_mapping(availability_by_faculty)


def build_candidate_indexes(
    input_data: NormalizedSolverInput,
    combo_by_id: Mapping[str, ComboEntity] | None = None,
) -> Mapping[str, ComboCandidateInfo]:
    class_by_id = {class_entity.id: class_entity for class_entity in input_data.classes}
    subject_by_id = {subject.id: subject for subject in input_data.subjects}
    combo_lookup = combo_by_id or build_combo_indexes(input_data)[0]
    break_hours = _break_hours(input_data)
    lab_block_size = max(1, int(_cfg_get(input_data.constraint_config, ["structural", "labBlockSize"], 2)))
    theory_block_size = max(1, int(_cfg_get(input_data.constraint_config, ["structural", "theoryBlockSize"], 1)))

    candidates_by_combo: Dict[str, ComboCandidateInfo] = {}
    for combo in combo_lookup.values():
        class_ids = tuple(class_id for class_id in combo.class_ids if class_id in class_by_id)
        subject = subject_by_id.get(combo.subject_id)
        required_hours_by_class = {
            class_id: _required_hours(class_by_id[class_id], subject)
            for class_id in class_ids
            if subject is not None
        }
        if not class_ids or subject is None or all(hours <= 0 for hours in required_hours_by_class.values()):
            continue

        block_size = lab_block_size if _is_lab_subject(subject) else theory_block_size
        is_lab = _is_lab_subject(subject)
        max_days = min((_class_days_per_week(class_by_id[class_id], input_data.days_per_week) for class_id in class_ids), default=input_data.days_per_week)
        candidate_starts: list[SlotRef] = []
        rejected_break = 0
        rejected_overflow = 0
        rejected_split_break = 0

        for day in range(max_days):
            for hour in range(input_data.hours_per_day):
                if hour in break_hours:
                    rejected_break += 1
                    continue
                if hour + block_size > input_data.hours_per_day:
                    rejected_overflow += 1
                    continue
                if any(h in break_hours for h in range(hour, hour + block_size)):
                    rejected_split_break += 1
                    continue
                candidate_starts.append(SlotRef(day=day, hour=hour))

        candidates_by_combo[combo.id] = ComboCandidateInfo(
            combo_id=combo.id,
            subject_id=combo.subject_id,
            class_ids=class_ids,
            faculty_ids=combo.faculty_ids,
            block_size=block_size,
            is_lab=is_lab,
            max_days=max_days,
            candidate_starts=tuple(candidate_starts),
            required_hours_by_class=MappingProxyType(dict(required_hours_by_class)),
            rejected_break_starts=rejected_break,
            rejected_overflow_starts=rejected_overflow,
            rejected_split_break_starts=rejected_split_break,
        )

    return _freeze_mapping(candidates_by_combo)


def build_variable_preparation(
    context: SolverModelContext,
    *,
    fixed_slot_keys: Iterable[Tuple[str, int, int]] = (),
    max_candidates_per_combo: int | None = None,
) -> VariablePreparationContext:
    fixed_keys = set(fixed_slot_keys)
    max_candidates = (
        max_candidates_per_combo
        if max_candidates_per_combo is not None
        else int(_cfg_get(context.input.constraint_config, ["solver", "maxCandidatesPerCombo"], 15))
    )
    hour_rank = {
        slot.hour: index
        for index, slot in enumerate(context.slots_by_day.get(0, ()))
        if slot.hour not in context.input.break_hours
    }
    availability_sets = {
        faculty_id: {(slot.day, slot.hour) for slot in slots}
        for faculty_id, slots in context.availability_by_faculty.items()
    }

    combo_candidate_starts: Dict[str, Tuple[SlotRef, ...]] = {}
    combo_search_rank: Dict[str, int] = {}
    class_slot_pressure: Dict[Tuple[str, int, int], int] = {}
    teacher_slot_pressure: Dict[Tuple[str, int, int], int] = {}

    for combo_id, candidate_info in context.candidates_by_combo.items():
        candidate_starts = candidate_info.candidate_starts
        if not candidate_starts:
            continue

        combo_candidate_starts[combo_id] = candidate_starts
        for slot in candidate_starts:
            for hour in range(slot.hour, slot.hour + candidate_info.block_size):
                for class_id in candidate_info.class_ids:
                    key = (class_id, slot.day, hour)
                    class_slot_pressure[key] = class_slot_pressure.get(key, 0) + 1
                for faculty_id in candidate_info.faculty_ids:
                    key = (faculty_id, slot.day, hour)
                    teacher_slot_pressure[key] = teacher_slot_pressure.get(key, 0) + 1

        required_hours = min(candidate_info.required_hours_by_class.values() or [0])
        availability_slots = sum(
            1
            for faculty_id in candidate_info.faculty_ids
            for slot in candidate_starts
            if any(
                (slot.day, hour) in availability_sets.get(faculty_id, set())
                for hour in range(slot.hour, slot.hour + candidate_info.block_size)
            )
        )
        fixed_bonus = sum(
            1 for slot in candidate_starts if (combo_id, slot.day, slot.hour) in fixed_keys
        )
        combo_search_rank[combo_id] = (
            (10000 if candidate_info.is_lab else 0)
            + (9000 if fixed_bonus > 0 else 0)
            + (7000 if len(candidate_info.class_ids) > 1 else 0)
            + (6000 if len(candidate_info.faculty_ids) <= 1 else 0)
            + (required_hours * 200)
            + (availability_slots * 25)
            - (len(candidate_starts) * 10)
        )

    sorted_combo_ids = tuple(
        combo.id
        for combo in sorted(
            context.input.combos,
            key=lambda combo: (
                -combo_search_rank.get(combo.id, -10**9),
                len(combo_candidate_starts.get(combo.id, ())),
                combo.id,
            ),
        )
    )

    ordered_starts_by_combo: Dict[str, Tuple[SlotRef, ...]] = {}
    for combo_id in sorted_combo_ids:
        candidate_info = context.candidates_by_combo.get(combo_id)
        if candidate_info is None:
            continue

        ordered_starts = sorted(
            candidate_info.candidate_starts,
            key=lambda slot: (
                -int((combo_id, slot.day, slot.hour) in fixed_keys),
                -sum(
                    class_slot_pressure.get((class_id, slot.day, hour), 0)
                    for hour in range(slot.hour, slot.hour + candidate_info.block_size)
                    for class_id in candidate_info.class_ids
                ),
                -sum(
                    teacher_slot_pressure.get((faculty_id, slot.day, hour), 0)
                    for hour in range(slot.hour, slot.hour + candidate_info.block_size)
                    for faculty_id in candidate_info.faculty_ids
                ),
                slot.day,
                hour_rank.get(slot.hour, slot.hour),
            ),
        )

        actual_max = 0 if candidate_info.is_lab else max_candidates
        if actual_max > 0 and len(ordered_starts) > actual_max:
            fixed_starts = [
                slot for slot in ordered_starts if (combo_id, slot.day, slot.hour) in fixed_keys
            ]
            non_fixed_starts = [
                slot for slot in ordered_starts if (combo_id, slot.day, slot.hour) not in fixed_keys
            ]
            ordered_starts = fixed_starts + non_fixed_starts[: max(0, actual_max - len(fixed_starts))]

        ordered_starts_by_combo[combo_id] = tuple(ordered_starts)

    return VariablePreparationContext(
        combo_candidate_starts=_freeze_mapping(combo_candidate_starts),
        combo_search_rank=_freeze_mapping(combo_search_rank),
        class_slot_pressure=_freeze_mapping(class_slot_pressure),
        teacher_slot_pressure=_freeze_mapping(teacher_slot_pressure),
        sorted_combo_ids=sorted_combo_ids,
        ordered_starts_by_combo=_freeze_mapping(ordered_starts_by_combo),
    )


def _break_hours(input_data: NormalizedSolverInput) -> set[int]:
    return set(input_data.break_hours)


def _class_days_per_week(class_entity: ClassEntity, global_days_per_week: int) -> int:
    return max(1, min(class_entity.days_per_week, max(1, global_days_per_week)))


def _required_hours(class_entity: ClassEntity, subject: SubjectEntity) -> int:
    if class_entity.subject_hours:
        return int(class_entity.subject_hours.get(subject.id, 0) or 0)
    return int(subject.hours_per_week or 0)


def _is_lab_subject(subject: SubjectEntity) -> bool:
    if subject.subject_type.strip().lower() == "lab":
        return True
    return "lab" in subject.name.strip().lower()


def _config_slots(raw_slots: Any) -> Tuple[SlotRef, ...]:
    if raw_slots is None:
        return ()
    if not isinstance(raw_slots, list):
        raw_slots = [raw_slots]

    slots: list[SlotRef] = []
    for raw_slot in raw_slots:
        if not isinstance(raw_slot, dict):
            continue
        try:
            day = int(raw_slot.get("day"))
            hour = int(raw_slot.get("hour"))
        except Exception:
            continue
        if day < 0 or hour < 0:
            continue
        slots.append(SlotRef(day=day, hour=hour))
    return tuple(slots)


def _dedupe_slots(slots: Iterable[SlotRef]) -> Tuple[SlotRef, ...]:
    seen: set[Tuple[int, int]] = set()
    deduped: list[SlotRef] = []
    for slot in slots:
        key = (slot.day, slot.hour)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(slot)
    return tuple(deduped)


def _cfg_get(config: Dict[str, Any], path: list[str], default: Any = None) -> Any:
    current: Any = config
    for key in path:
        if not isinstance(current, dict) or key not in current:
            return default
        current = current[key]
    return current


def _freeze_mapping(values: Dict[str, Any]) -> Mapping[str, Any]:
    return MappingProxyType(dict(values))


def _freeze_tuple_mapping(values: Dict[Any, list[Any]]) -> Mapping[Any, Tuple[Any, ...]]:
    return MappingProxyType({key: tuple(value) for key, value in values.items()})
