from __future__ import annotations

import unittest
from input.normalize import normalize_solver_payload
from model.builder import build_solver_model_context
from input.audit import audit_solver_input


class TestAudit(unittest.TestCase):
    def test_missing_combo_audit(self):
        payload = {
            "classes": [
                {
                    "id": "c1",
                    "name": "Class 1",
                    "days_per_week": 5,
                    "subject_hours": {"s1": 4}
                }
            ],
            "subjects": [
                {"id": "s1", "name": "Subject 1"}
            ],
            "faculties": [],
            "combos": [],  # Missing combo for s1
            "DAYS_PER_WEEK": 5,
            "HOURS_PER_DAY": 8
        }
        normalized = normalize_solver_payload(payload)
        context = build_solver_model_context(normalized)
        diagnostics = audit_solver_input(context)
        
        codes = [d["code"] for d in diagnostics]
        self.assertIn("MISSING_COMBO", codes)
        
    def test_faculty_overload_audit(self):
        payload = {
            "classes": [
                {
                    "id": "c1",
                    "name": "Class 1",
                    "days_per_week": 5,
                    "subject_hours": {"s1": 10}
                }
            ],
            "subjects": [
                {"id": "s1", "name": "Subject 1"}
            ],
            "faculties": [
                {
                    "id": "f1",
                    "name": "Faculty 1",
                    "preferences": {"maxLoad": 5}
                }
            ],
            "combos": [
                {
                    "id": "combo1",
                    "subject_id": "s1",
                    "faculty_ids": ["f1"],
                    "class_ids": ["c1"]
                }
            ],
            "DAYS_PER_WEEK": 5,
            "HOURS_PER_DAY": 8
        }
        normalized = normalize_solver_payload(payload)
        context = build_solver_model_context(normalized)
        diagnostics = audit_solver_input(context)
        
        codes = [d["code"] for d in diagnostics]
        self.assertIn("FACULTY_OVERLOAD", codes)

    def test_insufficient_availability_audit(self):
        payload = {
            "classes": [
                {
                    "id": "c1",
                    "name": "Class 1",
                    "days_per_week": 5,
                    "subject_hours": {"s1": 40} # Requires 40 hours
                }
            ],
            "subjects": [
                {"id": "s1", "name": "Subject 1"}
            ],
            "faculties": [
                {
                    "id": "f1",
                    "name": "Faculty 1",
                    "unavailable_slots": [{"day": 0, "hour": 0}]
                }
            ],
            "combos": [
                {
                    "id": "combo1",
                    "subject_id": "s1",
                    "faculty_ids": ["f1"],
                    "class_ids": ["c1"]
                }
            ],
            "DAYS_PER_WEEK": 5, # Total 5 * 8 = 40 slots
            "HOURS_PER_DAY": 8,
            "BREAK_HOURS": []
        }
        # Available = 40 - 1 = 39. Load = 40.
        normalized = normalize_solver_payload(payload)
        context = build_solver_model_context(normalized)
        diagnostics = audit_solver_input(context)
        
        codes = [d["code"] for d in diagnostics]
        self.assertIn("INSUFFICIENT_AVAILABILITY", codes)

    def test_impossible_combo_availability_audit(self):
        payload = {
            "classes": [
                {
                    "id": "c1",
                    "name": "Class 1",
                    "days_per_week": 1,
                    "subject_hours": {"s1": 1}
                }
            ],
            "subjects": [
                {"id": "s1", "name": "Subject 1"}
            ],
            "faculties": [
                {
                    "id": "f1",
                    "name": "Faculty 1",
                    "unavailable_slots": [{"day": 0, "hour": h} for h in range(8)] # Unavailable all day
                }
            ],
            "combos": [
                {
                    "id": "combo1",
                    "subject_id": "s1",
                    "faculty_ids": ["f1"],
                    "class_ids": ["c1"]
                }
            ],
            "DAYS_PER_WEEK": 1,
            "HOURS_PER_DAY": 8,
            "BREAK_HOURS": []
        }
        normalized = normalize_solver_payload(payload)
        context = build_solver_model_context(normalized)
        diagnostics = audit_solver_input(context)
        
        codes = [d["code"] for d in diagnostics]
        self.assertIn("IMPOSSIBLE_COMBO_AVAILABILITY", codes)

if __name__ == "__main__":
    unittest.main()
