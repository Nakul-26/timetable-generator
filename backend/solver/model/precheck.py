from __future__ import annotations

from typing import Any, Callable, Dict, Iterable, List, Mapping, Sequence, Tuple


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
) -> Tuple[List[Dict[str, Any]], List[str]]:
    """
    Validate and filter fixed slots before they are fed into the solver.

    The helper stays intentionally pure so the legacy solver can reuse it
    without dragging request-shaping logic back into app.py.
    """
    valid_fixed_slots: List[Dict[str, Any]] = []
    warnings: List[str] = []
    break_hours = set(int(hour) for hour in break_hours_set)

    for fs in fixed_slots:
        class_id = str(fs.get("class"))
        combo_id = str(fs.get("combo"))
        try:
            day = int(fs.get("day"))
            hour = int(fs.get("hour"))
        except Exception:
            warnings.append(f"Fixed slot has non-numeric day/hour: {fs}")
            continue

        class_doc = class_by_id.get(class_id)
        if class_doc is None:
            warnings.append(f"Fixed slot class not found: {class_id}")
            continue

        combo = combo_by_id.get(combo_id)
        if combo is None:
            warnings.append(f"Fixed slot combo not found: {combo_id}")
            continue

        if day < 0 or day >= class_days_per_week(class_doc):
            warnings.append(f"Fixed slot day out of range for class {class_id}: {day}")
            continue
        if hour < 0 or hour >= hours_per_day:
            warnings.append(f"Fixed slot hour out of range: {hour}")
            continue
        if hour in break_hours:
            warnings.append(
                f"Fixed slot falls in break hour for class {class_id} at {day},{hour}"
            )
            continue

        combo_class_ids = [str(cid) for cid in (combo.get("class_ids") or []) if str(cid).strip()]
        if combo_class_ids and class_id not in combo_class_ids:
            warnings.append(f"Fixed slot class {class_id} is not part of combo {combo_id}")
            continue

        if any(
            day >= class_days_per_week(class_by_id[cid])
            for cid in combo_class_ids
            if cid in class_by_id
        ):
            warnings.append(
                f"Fixed slot day out of range for one or more classes in combo {combo_id}: {day}"
            )
            continue

        if teacher_unavailable is not None:
            subject_ref = combo.get("subject")
            subject_doc = subject_ref if isinstance(subject_ref, dict) else subject_by_id.get(
                str(combo.get("subject_id") or "")
            )
            block_size = lab_block_size if is_lab_subject(subject_doc) else theory_block_size
            availability_conflict = False
            for fid in combo.get("faculty_ids", []):
                if any(
                    teacher_unavailable(str(fid), day, h)
                    for h in range(hour, min(hours_per_day, hour + block_size))
                ):
                    availability_conflict = True
                    break
            if availability_conflict:
                warnings.append(
                    f"Fixed slot violates teacher availability for class {class_id} at {day},{hour}"
                )
                continue

        valid_fixed_slots.append(
            {"class": class_id, "day": day, "hour": hour, "combo": combo_id}
        )

    return valid_fixed_slots, warnings
