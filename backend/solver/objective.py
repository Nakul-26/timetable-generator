"""
Objective function building for the CP-SAT solver.
"""

from typing import List
from ortools.sat.python import cp_model


def build_objective(
    model: cp_model.CpModel,
    objective_terms: List[cp_model.LinearExpr]
) -> None:
    """
    Set the objective function to minimize the sum of penalties.
    """
    if objective_terms:
        model.Minimize(sum(objective_terms))
    else:
        # If no soft constraints, minimize 0 (find any feasible solution)
        model.Minimize(0)