from __future__ import annotations

from typing import Any, Dict, List, Tuple

from input.normalize import normalize_solver_payload
from input.audit import audit_solver_input
from model.builder import build_solver_model_context


def build_job_payload_summary(body: Dict[str, Any] | None) -> Dict[str, Any]:
    """
    Build the lightweight job summary used by the /jobs endpoint.

    This intentionally consumes the normalized input contract so the summary
    logic stays aligned with the canonical solver boundary.
    """
    envelope = body or {}
    payload = envelope.get("payload") if isinstance(envelope, dict) else {}
    normalized = normalize_solver_payload(payload if isinstance(payload, dict) else {})
    raw_payload = payload if isinstance(payload, dict) else {}

    # Build model context to reuse its indexing logic for audit
    context = build_solver_model_context(normalized)
    diagnostics = audit_solver_input(context)

    subject_by_id = {subject.id: subject for subject in normalized.subjects}
    combo_count_by_pair: Dict[Tuple[str, str], int] = {}

    for combo in normalized.combos:
        for class_id in combo.class_ids:
            if not class_id:
                continue
            key = (class_id, combo.subject_id or "")
            combo_count_by_pair[key] = combo_count_by_pair.get(key, 0) + 1

    missing_lab_combos: List[Dict[str, Any]] = []
    missing_required_combos: List[Dict[str, Any]] = []
    required_summary: List[Dict[str, Any]] = []

    # Map diagnostics back to the existing fields for backward compatibility
    for d in diagnostics:
        if d["code"] == "MISSING_COMBO":
            # Find the subject name/type from the message if possible, or leave it thin
            missing_required_combos.append({
                "classId": d["entityId"],
                "className": d["entityName"],
                "message": d["message"],
                "severity": d["severity"]
            })
        elif d["code"] == "NO_FACULTY_ASSIGNED" and "lab" in d["message"].lower():
             missing_lab_combos.append({
                "classId": d["entityId"],
                "className": d["entityName"],
                "message": d["message"],
                "severity": d["severity"]
            })

    for class_entity in normalized.classes:
        required_pairs_for_class: List[Dict[str, Any]] = []
        total_required_hours = 0.0

        for subject_id, hours in class_entity.subject_hours.items():
            required = float(hours or 0)
            if required <= 0:
                continue

            total_required_hours += required
            subject = subject_by_id.get(subject_id)
            subject_type = (subject.subject_type if subject else "").strip().lower() or None
            subject_name = subject.name if subject else subject_id
            eligible = combo_count_by_pair.get((class_entity.id, subject_id), 0)

            required_pairs_for_class.append(
                {
                    "subjectId": subject_id,
                    "subjectName": subject_name,
                    "subjectType": subject_type,
                    "requiredHours": required,
                    "eligibleCombos": eligible,
                }
            )

        required_pairs_for_class.sort(
            key=lambda item: (
                -float(item.get("requiredHours") or 0),
                str(item.get("subjectName") or ""),
            )
        )
        required_summary.append(
            {
                "classId": class_entity.id,
                "className": class_entity.name,
                "classDaysPerWeekRaw": class_entity.days_per_week,
                "classDaysPerWeekParsed": class_entity.days_per_week,
                "requiredSubjectCount": len(required_pairs_for_class),
                "totalRequiredHours": total_required_hours,
                "topRequired": required_pairs_for_class[:12],
            }
        )

    combos_summary = []
    for combo in normalized.combos[:25]:
        subject = subject_by_id.get(combo.subject_id)
        combos_summary.append(
            {
                "comboId": combo.id,
                "subjectId": combo.subject_id,
                "subjectName": subject.name if subject else combo.subject_id,
                "subjectType": (subject.subject_type if subject else "").strip().lower() or None,
                "classIds": list(combo.class_ids),
                "facultyIds": list(combo.faculty_ids),
            }
        )

    summary = normalized.summary()
    return {
        "jobId": envelope.get("jobId"),
        "collegeId": raw_payload.get("collegeId"),
        "inputMode": normalized.input_mode,
        "schedule": {
            **summary["schedule"],
            "breakHours": raw_payload.get("BREAK_HOURS"),
        },
        "counts": summary["counts"],
        "diagnostics": diagnostics,
        "missingLabCombos": missing_lab_combos,
        "missingRequiredCombos": missing_required_combos[:50],
        "requiredSummary": required_summary[:10],
        "combosSummary": combos_summary,
    }
