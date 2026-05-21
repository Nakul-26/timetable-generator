from __future__ import annotations

from dataclasses import dataclass, field


from model.diagnostics import Diagnostic

@dataclass(frozen=True)
class ConstraintBuildResult:
    constraints_added: int = 0
    variables_created: int = 0
    diagnostics: list[Diagnostic] = field(default_factory=list)

