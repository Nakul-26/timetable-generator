from __future__ import annotations

from typing import Any, Mapping, Sequence, Tuple

from ortools.sat.python import cp_model

from constraints.result import ConstraintBuildResult


DecisionVarMap = Mapping[Tuple[str, int, int], cp_model.IntVar]
CoverVarMap = Mapping[Tuple[str, int, int], Sequence[cp_model.IntVar]]


from model.diagnostics import Diagnostic

def add_fixed_slot_constraints(
    *,
    model: cp_model.CpModel,
    fixed_slots: Sequence[Mapping[str, Any]],
    assignment_vars: DecisionVarMap | None = None,
    cover_vars: CoverVarMap | None = None,
) -> tuple[ConstraintBuildResult, list[Diagnostic]]:
    constraints_added = 0
    enforced_slots = 0
    missing_vars = 0
    diagnostics: list[Diagnostic] = []

    for fixed_slot in fixed_slots:
        class_id = str(fixed_slot.get("class"))
        day = int(fixed_slot.get("day"))
        hour = int(fixed_slot.get("hour"))
        combo_id = str(fixed_slot.get("combo"))
        vars_here = list((cover_vars or {}).get((combo_id, day, hour), ()))
        if not vars_here and assignment_vars is not None:
            var = assignment_vars.get((combo_id, day, hour))
            vars_here = [var] if var is not None else []

        if not vars_here:
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
            model.Add(0 == 1)
            constraints_added += 1
            continue

        model.Add(sum(vars_here) == 1)
        constraints_added += 1
        enforced_slots += 1

    summary_diagnostics = []
    if enforced_slots:
        summary_diagnostics.append(
            Diagnostic(
                severity="info",
                code="FIXED_SLOTS_ENFORCED",
                message=f"Fixed slots enforced {enforced_slots} required assignments."
            )
        )
    if missing_vars:
        summary_diagnostics.append(
            Diagnostic(
                severity="error",
                code="FIXED_SLOTS_SKIPPED",
                message=f"Fixed slots had {missing_vars} slots without candidate variables; generation is infeasible until they are corrected."
            )
        )

    return (
        ConstraintBuildResult(
            constraints_added=constraints_added,
            diagnostics=summary_diagnostics,
        ),
        diagnostics,
    )
