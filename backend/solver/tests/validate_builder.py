from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from input.normalize import normalize_solver_payload
from model.builder import build_solver_model_context, build_variable_preparation
from model.entities import SlotRef


def main() -> int:
    payload = {
        "classes": [
            {
                "_id": "class-1",
                "name": "CSE 1A",
                "days_per_week": 5,
                "subject_hours": {"subj-1": 4},
                "assigned_teacher_subject_combos": ["combo-1", "combo-2"],
            },
            {
                "_id": "class-2",
                "name": "CSE 1B",
                "days_per_week": 5,
                "subject_hours": {"subj-1": 4},
                "assigned_teacher_subject_combos": ["combo-2"],
            },
        ],
        "subjects": [
            {
                "_id": "subj-1",
                "name": "Mathematics",
                "type": "theory",
                "no_of_hours_per_week": 4,
            }
        ],
        "faculties": [
            {
                "_id": "teach-1",
                "name": "Teacher One",
                "unavailableSlots": [{"day": 1, "hour": 2}],
            },
            {
                "_id": "teach-2",
                "name": "Teacher Two",
                "unavailableSlots": [],
            },
        ],
        "combos": [
            {
                "_id": "combo-1",
                "subject_id": "subj-1",
                "faculty_ids": ["teach-1"],
                "class_ids": ["class-1"],
            },
            {
                "_id": "combo-2",
                "subject_id": "subj-1",
                "faculty_ids": ["teach-1", "teach-2"],
                "class_ids": ["class-1", "class-2"],
            },
        ],
        "fixedSlots": [
            {"class": "class-1", "combo": "combo-1", "day": 0, "hour": 1},
            {"class": "class-2", "combo": "combo-2", "day": 2, "hour": 3},
        ],
        "constraintConfig": {
            "schedule": {
                "daysPerWeek": 5,
                "hoursPerDay": 6,
                "breakHours": [0, 5, 99, 5],
            },
            "teacherAvailability": {
                "globallyUnavailableSlots": [{"day": 4, "hour": 5}],
                "unavailableSlotsByTeacher": {
                    "teach-2": [{"day": 3, "hour": 1}],
                },
            },
            "structural": {
                "theoryBlockSize": 2,
                "labBlockSize": 3,
            },
        },
    }

    normalized = normalize_solver_payload(payload)
    context = build_solver_model_context(normalized)

    assert set(context.combo_by_id) == {"combo-1", "combo-2"}
    assert [combo.id for combo in context.combos_by_class["class-1"]] == ["combo-1", "combo-2"]
    assert [combo.id for combo in context.combos_by_class["class-2"]] == ["combo-2"]
    assert [combo.id for combo in context.combos_by_faculty["teach-1"]] == ["combo-1", "combo-2"]
    assert [combo.id for combo in context.combos_by_faculty["teach-2"]] == ["combo-2"]

    assert len(context.slots_by_day) == 5
    assert context.input.break_hours == (0, 5)
    assert len(context.slots_by_day[0]) == 6
    assert len(context.break_slots) == 10
    assert len(context.teaching_slots) == 20
    assert context.break_slots[0] == SlotRef(day=0, hour=0)
    assert context.break_slots[1] == SlotRef(day=0, hour=5)

    assert [slot.combo_id for slot in context.fixed_slots_by_class["class-1"]] == ["combo-1"]
    assert [slot.combo_id for slot in context.fixed_slots_by_class["class-2"]] == ["combo-2"]
    assert [slot.combo_id for slot in context.fixed_slots_by_faculty["teach-1"]] == [
        "combo-1",
        "combo-2",
    ]
    assert [slot.combo_id for slot in context.fixed_slots_by_faculty["teach-2"]] == ["combo-2"]

    assert context.availability_by_faculty["teach-1"] == (
        SlotRef(day=4, hour=5),
        SlotRef(day=1, hour=2),
    )
    assert context.availability_by_faculty["teach-2"] == (
        SlotRef(day=4, hour=5),
        SlotRef(day=3, hour=1),
    )

    combo_1_candidates = context.candidates_by_combo["combo-1"]
    assert combo_1_candidates.class_ids == ("class-1",)
    assert combo_1_candidates.faculty_ids == ("teach-1",)
    assert combo_1_candidates.block_size == 2
    assert combo_1_candidates.max_days == 5
    assert len(combo_1_candidates.candidate_starts) == 15
    assert combo_1_candidates.candidate_starts[:3] == (
        SlotRef(day=0, hour=1),
        SlotRef(day=0, hour=2),
        SlotRef(day=0, hour=3),
    )
    assert combo_1_candidates.required_hours_by_class == {"class-1": 4}
    assert combo_1_candidates.rejected_break_starts == 10
    assert combo_1_candidates.rejected_overflow_starts == 0
    assert combo_1_candidates.rejected_split_break_starts == 5

    variable_prep = build_variable_preparation(
        context,
        fixed_slot_keys={("combo-1", 0, 1), ("combo-2", 2, 3)},
        max_candidates_per_combo=2,
    )
    assert set(variable_prep.combo_candidate_starts) == {"combo-1", "combo-2"}
    assert variable_prep.sorted_combo_ids[0] == "combo-2"
    assert variable_prep.ordered_starts_by_combo["combo-1"][0] == SlotRef(day=0, hour=1)
    assert variable_prep.ordered_starts_by_combo["combo-2"][0] == SlotRef(day=2, hour=3)
    assert len(variable_prep.ordered_starts_by_combo["combo-1"]) == 2
    assert len(variable_prep.ordered_starts_by_combo["combo-2"]) == 2
    assert variable_prep.class_slot_pressure[("class-1", 0, 1)] == 2
    assert variable_prep.teacher_slot_pressure[("teach-1", 0, 1)] == 2

    try:
        context.combo_by_id["new"] = normalized.combos[0]  # type: ignore[index]
    except TypeError:
        pass
    else:
        print("Expected combo_by_id to be immutable")
        return 1

    print("OK: build_solver_model_context")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
