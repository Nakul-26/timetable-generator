"""
Main solve function that orchestrates the CP-SAT solver.
"""

from typing import Dict, List, Any
from ortools.sat.python import cp_model
from .builder import build_variables
from .constraints import add_hard_constraints, add_soft_constraints
from .objective import build_objective


def solve_instance_clean(data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Clean solve function using modular components.
    """
    # Build model
    model = cp_model.CpModel()

    # Build variables
    x, covers, teacher_covers, subject_covers, search_ordered_vars, combo_candidate_starts, x_by_class_subject = build_variables(
        model, data, data["constraint_config"]
    )

    # Create occupancy variables
    class_occ = {}
    for cls in data["classes"]:
        class_id = cls["_id"]
        for day in range(data["DAYS_PER_WEEK"]):
            for hour in range(data["HOURS_PER_DAY"]):
                occ = model.NewBoolVar(f"class_occ_{class_id}_{day}_{hour}")
                vars_here = covers.get((class_id, day, hour), [])
                if vars_here:
                    model.Add(occ == sum(vars_here))
                else:
                    model.Add(occ == 0)
                class_occ[(class_id, day, hour)] = occ

    teacher_occ = {}
    for faculty in data["faculties"]:
        fid = faculty["_id"]
        for day in range(data["DAYS_PER_WEEK"]):
            for hour in range(data["HOURS_PER_DAY"]):
                occ = model.NewBoolVar(f"teacher_occ_{fid}_{day}_{hour}")
                vars_here = teacher_covers.get((fid, day, hour), [])
                if vars_here:
                    model.Add(occ == sum(vars_here))
                else:
                    model.Add(occ == 0)
                teacher_occ[(fid, day, hour)] = occ

    # Prepare vars dict
    vars = {
        "x": x,
        "covers": covers,
        "teacher_covers": teacher_covers,
        "subject_covers": subject_covers,
        "class_occ": class_occ,
        "teacher_occ": teacher_occ,
        "x_by_class_subject": x_by_class_subject,
    }

    objective_terms = []

    # Add constraints
    add_hard_constraints(model, data, vars)
    add_soft_constraints(model, data, vars, objective_terms)

    # Set objective
    build_objective(model, objective_terms)

    # Solve
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = data.get("solver_time_limit_sec", 180.0)
    status = solver.Solve(model)

    # Extract solution
    if status == cp_model.OPTIMAL or status == cp_model.FEASIBLE:
        # Build timetables
        class_timetables = {}
        # ... extract from x vars

        return {
            "ok": True,
            "class_timetables": class_timetables,
            "score": solver.ObjectiveValue(),
        }
    else:
        return {
            "ok": False,
            "error": f"No solution found, status: {status}",
        }