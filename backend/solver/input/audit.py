from __future__ import annotations

from typing import Any, Dict, List

from model.builder import SolverModelContext
from model.diagnostics import DiagnosticCollector


def audit_solver_input(context: SolverModelContext) -> List[Dict[str, Any]]:
    collector = DiagnosticCollector()
    input_data = context.input
    
    subject_by_id = {s.id: s for s in input_data.subjects}
    faculty_by_id = {f.id: f for f in input_data.faculties}
    
    # 1. Check for no-teacher subjects (missing combos for required subject hours)
    for class_entity in input_data.classes:
        for subject_id, hours in class_entity.subject_hours.items():
            if hours <= 0:
                continue
                
            subject = subject_by_id.get(subject_id)
            subject_name = subject.name if subject else subject_id
            
            # Find combos for this class and subject
            combos = [
                c for c in context.combos_by_class.get(class_entity.id, ())
                if c.subject_id == subject_id
            ]
            
            if not combos:
                collector.error(
                    code="MISSING_COMBO",
                    message=f"No faculty assigned to {subject_name} for class {class_entity.name}.",
                    entity_type="class",
                    entity_id=class_entity.id,
                    entity_name=class_entity.name
                )
            else:
                # Check if any combo has no faculty
                for combo in combos:
                    if not combo.faculty_ids:
                        collector.warning(
                            code="NO_FACULTY_ASSIGNED",
                            message=f"Subject {subject_name} in class {class_entity.name} has a teaching allocation but no faculty assigned.",
                            entity_type="combo",
                            entity_id=combo.id,
                            entity_name=subject_name
                        )

    # 2. Check Faculty Load
    faculty_load: Dict[str, float] = {}
    for combo_id, candidate in context.candidates_by_combo.items():
        # Get max required hours across classes for this combo (conservative estimate for now)
        # Actually, for each class in the combo, it consumes those hours.
        # If it's a combined class, it might be the same hours.
        # For simplicity, let's take the required hours from one of the classes.
        hours = max(candidate.required_hours_by_class.values(), default=0)
        
        for faculty_id in candidate.faculty_ids:
            faculty_load[faculty_id] = faculty_load.get(faculty_id, 0) + hours
            
    for faculty_id, load in faculty_load.items():
        faculty = faculty_by_id.get(faculty_id)
        if not faculty:
            continue
            
        # Preference: maxLoad
        max_load = float(faculty.preferences.get("maxLoad", 0))
        if max_load > 0 and load > max_load:
            collector.warning(
                code="FACULTY_OVERLOAD",
                message=f"Faculty {faculty.name} assigned {load} hours, exceeding preferred max of {max_load}.",
                entity_type="faculty",
                entity_id=faculty.id,
                entity_name=faculty.name
            )

    # 3. Basic Availability Check
    total_slots = input_data.days_per_week * (input_data.hours_per_day - len(input_data.break_hours))
    for faculty_id, load in faculty_load.items():
        faculty = faculty_by_id.get(faculty_id)
        if not faculty:
            continue
            
        unavailable_slots = context.availability_by_faculty.get(faculty_id, ())
        unavailable_count = len(unavailable_slots)
        available_count = total_slots - unavailable_count
        
        if load > available_count:
            collector.error(
                code="INSUFFICIENT_AVAILABILITY",
                message=f"Faculty {faculty.name} requires {load} hours but only has {available_count} slots available.",
                entity_type="faculty",
                entity_id=faculty.id,
                entity_name=faculty.name
            )

    # 4. Check for combos with NO valid slots due to teacher availability
    for combo_id, candidate in context.candidates_by_combo.items():
        if not candidate.candidate_starts:
            # This is already handled by build_candidate_indexes (it wouldn't be in candidates_by_combo)
            # but we can check if it was filtered out.
            continue
            
        valid_starts_considering_availability = []
        for start in candidate.candidate_starts:
            is_valid = True
            for faculty_id in candidate.faculty_ids:
                unavailable = context.availability_by_faculty.get(faculty_id, ())
                unavailable_set = {(s.day, s.hour) for s in unavailable}
                
                # Check all slots in the block
                if any((start.day, hour) in unavailable_set for hour in range(start.hour, start.hour + candidate.block_size)):
                    is_valid = False
                    break
            if is_valid:
                valid_starts_considering_availability.append(start)
                
        if not valid_starts_considering_availability:
            subject = subject_by_id.get(candidate.subject_id)
            subject_name = subject.name if subject else candidate.subject_id
            faculty_names = [faculty_by_id[fid].name for fid in candidate.faculty_ids if fid in faculty_by_id]
            
            collector.error(
                code="IMPOSSIBLE_COMBO_AVAILABILITY",
                message=f"No valid time slots found for {subject_name} with faculty {', '.join(faculty_names)} due to availability constraints.",
                entity_type="combo",
                entity_id=combo_id,
                entity_name=subject_name
            )

    return collector.to_list()
