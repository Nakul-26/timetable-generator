from __future__ import annotations

from typing import Any, Mapping, Sequence, Tuple

from ortools.sat.python import cp_model

from constraints.result import ConstraintBuildResult


DecisionVarMap = Mapping[Tuple[str, int, int], cp_model.IntVar]


from model.diagnostics import Diagnostic

def add_fixed_slot_constraints(
    *,
    model: cp_model.CpModel,
    fixed_slots: Sequence[Mapping[str, Any]],
    assignment_vars: DecisionVarMap,
) -> tuple[ConstraintBuildResult, list[Diagnostic]]:
    constraints_added = 0
    missing_vars = 0
    diagnostics: list[Diagnostic] = []

    for fixed_slot in fixed_slots:
        class_id = str(fixed_slot.get("class"))
        day = int(fixed_slot.get("day"))
        hour = int(fixed_slot.get("hour"))
        combo_id = str(fixed_slot.get("combo"))
        var = assignment_vars.get((combo_id, day, hour))
        if var is None:
            missing_vars += 1
            diagnostics.append(
                Diagnostic(
                    severity="error",
                    code="FIXED_SLOT_MISSING_VARIABLE",
                    message=f"Fixed slot invalid for class {class_id} combo {combo_id} at Day {day}, Hour {hour}. No solver variable exists for this placement.",
                    entity_type="class",
                    entity_id=class_id
                )
            )
            continue

        model.Add(var == 1)
        constraints_added += 1

    summary_diagnostics = []
    if constraints_added:
        summary_diagnostics.append(
            Diagnostic(
                severity="info",
                code="FIXED_SLOTS_ENFORCED",
                message=f"Fixed slots enforced {constraints_added} required assignments."
            )
        )
    if missing_vars:
        summary_diagnostics.append(
            Diagnostic(
                severity="warning",
                code="FIXED_SLOTS_SKIPPED",
                message=f"Fixed slots skipped {missing_vars} slots without candidate variables."
            )
        )

    return (
        ConstraintBuildResult(
            constraints_added=constraints_added,
            diagnostics=summary_diagnostics,
        ),
        diagnostics,
    )

