from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from model.precheck import validate_fixed_slots


def main() -> int:
    class_by_id = {
        "class-1": {"_id": "class-1", "days_per_week": 5},
    }
    combo_by_id = {
        "combo-1": {
            "_id": "combo-1",
            "subject_id": "subj-1",
            "faculty_ids": ["teach-1"],
            "class_ids": ["class-1"],
        }
    }
    subject_by_id = {
        "subj-1": {"_id": "subj-1", "name": "Physics Lab", "type": "lab"},
    }

    fixed_slots = [
        {"class": "class-1", "combo": "combo-1", "day": 1, "hour": 2},
        {"class": "class-1", "combo": "combo-1", "day": 9, "hour": 2},
    ]

    valid_slots, diagnostics = validate_fixed_slots(
        fixed_slots=fixed_slots,
        class_by_id=class_by_id,
        combo_by_id=combo_by_id,
        subject_by_id=subject_by_id,
        hours_per_day=8,
        break_hours_set={0},
        class_days_per_week=lambda cls: int(cls.get("days_per_week") or 0),
        is_lab_subject=lambda subj: bool(subj and str(subj.get("type") or "").strip().lower() == "lab"),
        teacher_unavailable=lambda _fid, day, hour: day == 1 and hour == 2,
        theory_block_size=1,
        lab_block_size=2,
    )

    actual_warnings = [d["message"] for d in diagnostics]
    expected_valid = []
    expected_warnings = [
        "Fixed slot violates teacher availability for class class-1 at Day 1, Hour 2.",
        "Fixed slot day 9 out of range for class class-1.",
    ]

    if valid_slots != expected_valid or actual_warnings != expected_warnings:
        print("Expected valid slots:")
        print(json.dumps(expected_valid, indent=2, sort_keys=True))
        print("Actual valid slots:")
        print(json.dumps(valid_slots, indent=2, sort_keys=True))
        print("Expected warnings:")
        print(json.dumps(expected_warnings, indent=2, sort_keys=True))
        print("Actual warnings:")
        print(json.dumps(actual_warnings, indent=2, sort_keys=True))
        return 1

    print("OK: validate_fixed_slots")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
