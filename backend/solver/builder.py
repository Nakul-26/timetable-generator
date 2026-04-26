"""
Variable and model building for the CP-SAT solver.
"""

from typing import Dict, List, Any, Tuple
from ortools.sat.python import cp_model


def build_variables(
    model: cp_model.CpModel,
    data: Dict[str, Any],
    constraint_config: Dict[str, Any]
) -> Tuple[
    Dict[Tuple[str, int, int], cp_model.IntVar],
    Dict[Tuple[str, int, int], List[cp_model.IntVar]],
    Dict[Tuple[str, int, int], List[cp_model.IntVar]],
    Dict[Tuple[str, int, int, str], List[cp_model.IntVar]],
    List[cp_model.IntVar],
    Dict[str, List[Tuple[int, int]]],
]:
    """
    Build decision variables for combo placements.

    Returns:
        x: Decision vars for combo/day/hour starts
        covers: Vars covering class slots
        teacher_covers: Vars covering teacher slots
        subject_covers: Vars covering class-subject slots
        search_ordered_vars: Vars for solver search order
        combo_candidate_starts: Valid start positions per combo
    """
    # Extract data
    combos = data["combos"]
    classes = data["classes"]
    faculties = data["faculties"]
    subjects = data["subjects"]
    days_per_week = data["DAYS_PER_WEEK"]
    hours_per_day = data["HOURS_PER_DAY"]
    break_hours_set = set(data.get("BREAK_HOURS", []))
    lab_block_size = data["lab_block_size"]
    theory_block_size = data["theory_block_size"]
    max_candidates_per_combo = data["max_candidates_per_combo"]
    teacher_avail_enabled = data["teacher_avail_enabled"]
    teacher_avail_hard = data["teacher_avail_hard"]
    teacher_avail_weight = data["teacher_avail_weight"]
    teacher_avail_global = data["teacher_avail_global"]
    teacher_avail_by_teacher = data["teacher_avail_by_teacher"]
    fixed_slot_keys = data["fixed_slot_keys"]
    debug_labs = data["debug_labs"]

    # Helper dicts
    class_by_id = {c["_id"]: c for c in classes}
    subject_by_id = {s["_id"]: s for s in subjects}
    faculty_by_id = {f["_id"]: f for f in faculties}
    combo_by_id = {c["_id"]: c for c in combos}

    # Decision variables
    x: Dict[Tuple[str, int, int], cp_model.IntVar] = {}
    covers: Dict[Tuple[str, int, int], List[cp_model.IntVar]] = {}
    teacher_covers: Dict[Tuple[str, int, int], List[cp_model.IntVar]] = {}
    subject_covers: Dict[Tuple[str, int, int, str], List[cp_model.IntVar]] = {}
    combo_candidate_starts: Dict[str, List[Tuple[int, int]]] = {}
    search_ordered_vars: List[cp_model.IntVar] = []

    def _is_lab_subject(subj: Dict[str, Any]) -> bool:
        subj_type = str(subj.get("type") or "").strip().lower()
        if subj_type == "lab":
            return True
        subj_name = str(subj.get("name") or "").strip().lower()
        return "lab" in subj_name

    # Build candidate starts and variables
    for combo in combos:
        combo_id = combo["_id"]
        class_ids = [cid for cid in (combo.get("class_ids") or []) if cid in class_by_id]
        if not class_ids:
            continue
        subj = subject_by_id.get(combo["subject_id"])
        if not subj:
            continue
        block = lab_block_size if _is_lab_subject(subj) else theory_block_size
        max_days_for_combo = min(
            [int(class_by_id[cid].get("days_per_week") or days_per_week) for cid in class_ids] or [days_per_week]
        )
        candidate_starts: List[Tuple[int, int]] = []
        for day in range(max_days_for_combo):
            for hour in range(hours_per_day):
                if hour in break_hours_set:
                    continue
                if hour + block > hours_per_day:
                    continue
                if any(h in break_hours_set for h in range(hour, hour + block)):
                    continue
                candidate_starts.append((day, hour))

        if not candidate_starts:
            continue

        combo_candidate_starts[combo_id] = candidate_starts

        # Limit candidates
        if max_candidates_per_combo > 0 and len(candidate_starts) > max_candidates_per_combo:
            fixed_starts = [
                slot for slot in candidate_starts if (combo_id, slot[0], slot[1]) in fixed_slot_keys
            ]
            non_fixed_starts = [
                slot for slot in candidate_starts if (combo_id, slot[0], slot[1]) not in fixed_slot_keys
            ]
            remaining_capacity = max(0, max_candidates_per_combo - len(fixed_starts))
            candidate_starts = fixed_starts + non_fixed_starts[:remaining_capacity]

        for day, hour in candidate_starts:
            violates_availability = False
            if teacher_avail_enabled:
                for fid in combo.get("faculty_ids", []):
                    if any(_is_teacher_unavailable(fid, day, h, teacher_avail_global, teacher_avail_by_teacher, days_per_week, hours_per_day, break_hours_set) for h in range(hour, hour + block)):
                        violates_availability = True
                        break

            var = model.NewBoolVar(f"x_{combo_id}_{day}_{hour}")
            x[(combo_id, day, hour)] = var
            search_ordered_vars.append(var)

            # Add to covers
            for h in range(hour, hour + block):
                for class_id in class_ids:
                    covers.setdefault((class_id, day, h), []).append(var)
                    subject_covers.setdefault((class_id, day, h, combo["subject_id"]), []).append(var)
                for fid in combo.get("faculty_ids", []):
                    teacher_covers.setdefault((fid, day, h), []).append(var)

    return x, covers, teacher_covers, subject_covers, search_ordered_vars, combo_candidate_starts


def _is_teacher_unavailable(fid: str, day: int, hour: int, global_unavail: set, by_teacher: Dict[str, set], days_per_week: int, hours_per_day: int, break_hours_set: set) -> bool:
    if (day, hour) in global_unavail:
        return True
    teacher_slots = by_teacher.get(fid)
    if teacher_slots and (day, hour) in teacher_slots:
        return True
    return False
