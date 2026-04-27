"""
Constraint definitions for the CP-SAT solver.
"""

from typing import Dict, List, Any
from ortools.sat.python import cp_model


def add_hard_constraints(
    model: cp_model.CpModel,
    data: Dict[str, Any],
    vars: Dict[str, Any]
) -> None:
    """
    Add hard constraints that must be satisfied.
    """
    classes = data["classes"]
    faculties = data["faculties"]
    days_per_week = data["DAYS_PER_WEEK"]
    hours_per_day = data["HOURS_PER_DAY"]
    break_hours_set = data["break_hours_set"]
    covers = vars["covers"]
    teacher_covers = vars["teacher_covers"]
    class_occ = vars["class_occ"]
    teacher_occ = vars["teacher_occ"]
    x_by_class_subject = vars["x_by_class_subject"]
    weekly_hours_hard = data["weekly_hours_hard"]

    # At most one lesson per class per hour
    for cls in classes:
        class_id = cls["_id"]
        days = int(cls.get("days_per_week") or days_per_week)
        for day in range(days):
            for hour in range(hours_per_day):
                if hour in break_hours_set:
                    continue
                vars_here = covers.get((class_id, day, hour), [])
                if vars_here:
                    model.AddAtMostOne(vars_here)

    # Teacher clash
    faculty_ids = [f["_id"] for f in faculties]
    for fid in faculty_ids:
        for day in range(days_per_week):
            for hour in range(hours_per_day):
                if hour in break_hours_set:
                    continue
                vars_here = teacher_covers.get((fid, day, hour), [])
                if vars_here:
                    model.AddAtMostOne(vars_here)

    # Weekly subject hours (hard)
    if weekly_hours_hard:
        for (class_id, subj_id), terms in x_by_class_subject.items():
            req = data["required_hours_by_class_subject"][class_id][subj_id]
            if req > 0:
                # terms is a list of (variable, block_size)
                actual_terms = [var * block for (var, block) in terms]
                scheduled_terms = sum(actual_terms) if actual_terms else 0
                model.Add(scheduled_terms == req)


def add_soft_constraints(
    model: cp_model.CpModel,
    data: Dict[str, Any],
    vars: Dict[str, Any],
    objective_terms: List[cp_model.LinearExpr]
) -> None:
    """
    Add soft constraints with penalties.
    """
    # Weekly subject hours (soft)
    weekly_hours_hard = data["weekly_hours_hard"]
    weekly_hours_shortage_weight = data["weekly_hours_shortage_weight"]
    x_by_class_subject = vars["x_by_class_subject"]
    required_hours_by_class_subject = data["required_hours_by_class_subject"]

    if not weekly_hours_hard:
        for (class_id, subj_id), terms in x_by_class_subject.items():
            req = required_hours_by_class_subject[class_id][subj_id]
            if req > 0:
                actual_terms = [var * block for (var, block) in terms]
                scheduled_terms = sum(actual_terms) if actual_terms else 0
                scheduled = model.NewIntVar(0, req + 5, f"scheduled_{class_id}_{subj_id}") # Allow slight overage for labs
                model.Add(scheduled == scheduled_terms)
                shortage = model.NewIntVar(0, req, f"shortage_{class_id}_{subj_id}")
                model.Add(scheduled + shortage >= req)
                objective_terms.append(shortage * weekly_hours_shortage_weight)

    # Add other soft constraints here...
    # (Teacher continuity, class continuity, etc.)