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
    x, covers, teacher_covers, subject_covers, search_ordered_vars, combo_candidate_starts = build_variables(
        model, data, data["constraint_config"]
    )

    # Create occupancy variables
    class_occ = {}
    teacher_occ = {}
    # ... (similar to original)

    # Prepare vars dict
    vars = {
        "x": x,
        "covers": covers,
        "teacher_covers": teacher_covers,
        "subject_covers": subject_covers,
        "class_occ": class_occ,
        "teacher_occ": teacher_occ,
        "x_by_class_subject": {},  # Build this
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