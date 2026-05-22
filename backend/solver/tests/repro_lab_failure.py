import sys
import os
import json
from pathlib import Path

# Add solver dir to path
SOLVER_DIR = Path(__file__).parent.parent
sys.path.insert(0, str(SOLVER_DIR))

from engine.solve import solve_instance
from infra.logging_setup import configure_logging

def test_repro():
    configure_logging(debug=True)
    payload = {
        "collegeId": "test-college",
        "daysPerWeek": 6,
        "hoursPerDay": 8,
        "faculties": [
            {"_id": "T1", "name": "Dr. Dhanalakshmi B K", "unavailableSlots": []},
            {"_id": "T2", "name": "Mrs. Packiya Lekshmi", "unavailableSlots": []},
            {"_id": "T3", "name": "Mr. Beerappa Belasakarge", "unavailableSlots": []},
            {"_id": "T4", "name": "Dr. Mohammed Khurram", "unavailableSlots": []},
            {"_id": "T5", "name": "Dr. Nagabhushan SV", "unavailableSlots": []},
        ],
        "subjects": [
            {"_id": "S1", "name": "Cloud Computing", "type": "lab", "hoursPerWeek": 3},
            {"_id": "S2", "name": "cloud computing (Lab)", "type": "lab", "hoursPerWeek": 2},
            {"_id": "S3", "name": "Compiler Design", "type": "theory", "hoursPerWeek": 3},
            {"_id": "S4", "name": "Machine Learning", "type": "theory", "hoursPerWeek": 4},
        ],
        "classes": [
            {
                "_id": "C1",
                "name": "VI-B",
                "subject_hours": {
                    "S1": 3,
                    "S2": 2,
                    "S3": 3,
                    "S4": 4
                },
                "assigned_teacher_subject_combos": ["CB1", "CB2", "CB3", "CB4"]
            }
        ],
        "combos": [
            {
                "_id": "CB1",
                "subject_id": "S1",
                "faculty_ids": ["T1"],
                "class_ids": ["C1"]
            },
            {
                "_id": "CB2",
                "subject_id": "S2",
                "faculty_ids": ["T1", "T2", "T3"],
                "class_ids": ["C1"]
            },
            {
                "_id": "CB3",
                "subject_id": "S3",
                "faculty_ids": ["T4"],
                "class_ids": ["C1"]
            },
            {
                "_id": "CB4",
                "subject_id": "S4",
                "faculty_ids": ["T5"],
                "class_ids": ["C1"]
            }
        ],
        "constraintConfig": {
            "schedule": {"breakHours": [4]},
            "structural": {
                "labBlockSize": 2,
                "theoryBlockSize": 1
            },
            "weeklySubjectHours": {"hard": True},
            "solver": {
                "maxCandidatesPerCombo": 100
            },
            "noGaps": {"hard": False}
        },
        "solver_time_limit_sec": 30
    }

    print("Running solver reproduction...")
    result = solve_instance(payload)
    
    print(f"Result OK: {result.get('ok')}")
    if not result.get('ok'):
        print(f"Error: {result.get('error')}")
        print(f"Reason: {result.get('reason')}")
        print(f"Diagnostics: {json.dumps(result.get('diagnostics'), indent=2)}")
    else:
        print("Success! Timetable generated.")
        print("Subject Hours Report:")
        report = {}
        # We need a combo lookup to get the subjectId
        combo_to_subject = {c["_id"]: c["subject_id"] for c in payload["combos"]}
        
        for class_id, days in result.get('class_timetables', {}).items():
            for day_idx, day_slots in enumerate(days):
                for slot in day_slots:
                    if isinstance(slot, str) and slot in combo_to_subject:
                        sid = combo_to_subject[slot]
                        report[sid] = report.get(sid, 0) + 1
        for sid, hours in report.items():
            print(f"  {sid}: {hours}")

if __name__ == "__main__":
    test_repro()
