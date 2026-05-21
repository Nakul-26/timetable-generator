from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional


@dataclass(frozen=True)
class Diagnostic:
    severity: str  # "error", "warning", "info"
    code: str
    message: str
    entity_type: Optional[str] = None
    entity_id: Optional[str] = None
    entity_name: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "severity": self.severity,
            "code": self.code,
            "message": self.message,
            "entityType": self.entity_type,
            "entityId": self.entity_id,
            "entityName": self.entity_name,
        }


class DiagnosticCollector:
    def __init__(self):
        self.diagnostics: List[Diagnostic] = []

    def error(
        self,
        code: str,
        message: str,
        entity_type: Optional[str] = None,
        entity_id: Optional[str] = None,
        entity_name: Optional[str] = None,
    ):
        self.diagnostics.append(
            Diagnostic(
                severity="error",
                code=code,
                message=message,
                entity_type=entity_type,
                entity_id=entity_id,
                entity_name=entity_name,
            )
        )

    def warning(
        self,
        code: str,
        message: str,
        entity_type: Optional[str] = None,
        entity_id: Optional[str] = None,
        entity_name: Optional[str] = None,
    ):
        self.diagnostics.append(
            Diagnostic(
                severity="warning",
                code=code,
                message=message,
                entity_type=entity_type,
                entity_id=entity_id,
                entity_name=entity_name,
            )
        )

    def info(
        self,
        code: str,
        message: str,
        entity_type: Optional[str] = None,
        entity_id: Optional[str] = None,
        entity_name: Optional[str] = None,
    ):
        self.diagnostics.append(
            Diagnostic(
                severity="info",
                code=code,
                message=message,
                entity_type=entity_type,
                entity_id=entity_id,
                entity_name=entity_name,
            )
        )

    def get_diagnostics(self) -> List[Diagnostic]:
        return self.diagnostics

    def to_list(self) -> List[Dict[str, Any]]:
        return [d.to_dict() for d in self.diagnostics]
