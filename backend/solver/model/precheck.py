from __future__ import annotations

from typing import Any, Callable, Dict, Iterable, List, Mapping, Sequence, Tuple


from model.diagnostics import DiagnosticCollector

def validate_fixed_slots(
    *,
    fixed_slots: Sequence[Dict[str, Any]],
    class_by_id: Mapping[str, Dict[str, Any]],
    combo_by_id: Mapping[str, Dict[str, Any]],
    subject_by_id: Mapping[str, Dict[str, Any]],
    hours_per_day: int,
    break_hours_set: Iterable[int],
    class_days_per_week: Callable[[Dict[str, Any]], int],
    is_lab_subject: Callable[[Dict[str, Any] | None], bool],
    teacher_unavailable: Callable[[str, int, int], bool] | None = None,
    theory_block_size: int = 1,
    lab_block_size: int = 2,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Validate and filter fixed slots before they are fed into the solver.
    """
    valid_fixed_slots: List[Dict[str, Any]] = []
    collector = DiagnosticCollector()
    break_hours = set(int(hour) for hour in break_hours_set)

    for fs in fixed_slots:
        class_id = str(fs.get("class"))
        combo_id = str(fs.get("combo"))
        try:
            day = int(fs.get("day"))
            hour = int(fs.get("hour"))
        except Exception:
            collector.error("INVALID_FIXED_SLOT_FORMAT", f"Fixed slot has non-numeric day/hour: {fs}")
            continue

        class_doc = class_by_id.get(class_id)
        if class_doc is None:
            collector.error("FIXED_SLOT_CLASS_NOT_FOUND", f"Fixed slot class not found: {class_id}", "class", class_id)
            continue

        combo = combo_by_id.get(combo_id)
        if combo is None:
            collector.error("FIXED_SLOT_COMBO_NOT_FOUND", f"Fixed slot combo not found: {combo_id}", "combo", combo_id)
            continue

        class_name = class_doc.get("name") or class_id

        if day < 0 or day >= class_days_per_week(class_doc):
            collector.error("FIXED_SLOT_DAY_OUT_OF_RANGE", f"Fixed slot day {day} out of range for class {class_name}.", "class", class_id, class_name)
            continue
        if hour < 0 or hour >= hours_per_day:
            collector.error("FIXED_SLOT_HOUR_OUT_OF_RANGE", f"Fixed slot hour {hour} out of range.", "class", class_id, class_name)
            continue
        if hour in break_hours:
            collector.error("FIXED_SLOT_BREAK_HOUR_CONFLICT", f"Fixed slot falls in break hour for class {class_name} at Day {day}, Hour {hour}.", "class", class_id, class_name)
            continue

        combo_class_ids = [str(cid) for cid in (combo.get("class_ids") or []) if str(cid).strip()]
        if combo_class_ids and class_id not in combo_class_ids:
            collector.error("FIXED_SLOT_CLASS_MISMATCH", f"Fixed slot class {class_name} is not part of combo {combo_id}", "combo", combo_id)
            continue

        if teacher_unavailable is not None:
            subject_ref = combo.get("subject")
            subject_doc = subject_ref if isinstance(subject_ref, dict) else subject_by_id.get(
                str(combo.get("subject_id") or "")
            )
            block_size = lab_block_size if is_lab_subject(subject_doc) else theory_block_size
            availability_conflict = False
            conflicting_faculty = None
            for fid in combo.get("faculty_ids", []):
                if any(
                    teacher_unavailable(str(fid), day, h)
                    for h in range(hour, min(hours_per_day, hour + block_size))
                ):
                    availability_conflict = True
                    conflicting_faculty = fid
                    break
            if availability_conflict:
                collector.error("FIXED_SLOT_AVAILABILITY_CONFLICT", f"Fixed slot violates teacher availability for class {class_name} at Day {day}, Hour {hour}.", "faculty", conflicting_faculty)
                continue

        valid_fixed_slots.append(
            {"class": class_id, "day": day, "hour": hour, "combo": combo_id}
        )

    return valid_fixed_slots, collector.to_list()
