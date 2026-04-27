from __future__ import annotations

import os
import sys
import threading
from pathlib import Path
from typing import Any, Dict, List, Tuple, Optional

# Allow running/importing from repo root as well as from within backend/solver.
_SOLVER_DIR = Path(__file__).resolve().parent
if str(_SOLVER_DIR) not in sys.path:
    sys.path.insert(0, str(_SOLVER_DIR))

from ortools.sat.python import cp_model

from infra.logging_setup import get_logger
from solver_common import (
    BREAK,
    DEFAULT_SOLVER_TIME_LIMIT_SEC,
    DEFAULT_SOLUTION_COUNT,
    EMPTY,
    _cfg_get,
    _normalize_slot_list,
    _normalize_teacher_preferences_map,
    _normalize_teacher_slot_map,
    _to_bool,
)

logger = get_logger("timetable.solver.core")
DEBUG = os.getenv("DEBUG_SOLVER", "0").strip().lower() in ("1", "true", "yes", "on")


def _solve_with_solution_callback(solver, model, callback):
    solve_method = getattr(solver, "SolveWithSolutionCallback", None)
    if callable(solve_method):
        return solve_method(model, callback)

    solve_method = getattr(solver, "solve_with_solution_callback", None)
    if callable(solve_method):
        return solve_method(model, callback)

    solve_method = getattr(solver, "solve", None)
    if callable(solve_method):
        return solve_method(model, solution_callback=callback)

    solve_method = getattr(solver, "Solve", None)
    if callable(solve_method):
        return solve_method(model, callback)

    raise AttributeError(
        "CpSolver does not support solution callback solving on this OR-Tools build"
    )


def _stop_search(solver) -> None:
    stop_method = getattr(solver, "StopSearch", None)
    if callable(stop_method):
        stop_method()
        return

    stop_method = getattr(solver, "stop_search", None)
    if callable(stop_method):
        stop_method()
        return

    raise AttributeError("CpSolver does not support stop_search on this OR-Tools build")


class _SolveProgressCallback(cp_model.CpSolverSolutionCallback):
    def __init__(self) -> None:
        super().__init__()
        self.solution_found = False
        self.solution_count = 0
        self.first_solution_wall_time_seconds = 0.0

    def on_solution_callback(self) -> None:
        self.solution_found = True
        self.solution_count += 1
        if self.solution_count == 1:
            self.first_solution_wall_time_seconds = float(self.WallTime())


def _normalize_id(item: Dict[str, Any]) -> Dict[str, Any]:
    _id = item.get("_id") or item.get("id")
    return {**item, "_id": str(_id)}


def _required_hours(class_obj: Dict[str, Any], subject_obj: Dict[str, Any]) -> int:
    subj_id = subject_obj["_id"]
    subj_hours = class_obj.get("subject_hours") or {}
    # When class-specific subject hours are present, they are authoritative:
    # subjects not listed for the class must be treated as 0 required hours.
    if isinstance(subj_hours, dict) and len(subj_hours) > 0:
        if subj_id in subj_hours and subj_hours[subj_id] is not None:
            return int(subj_hours[subj_id])
        return 0
    return int(subject_obj.get("no_of_hours_per_week") or 0)


def solve_instance(payload: Dict[str, Any]) -> Dict[str, Any]:
    logger.info(
        "solve_instance started: keys=%d combos=%d classes=%d subjects=%d faculties=%d inputMode=%s daysPerWeek=%s hoursPerDay=%s",
        len(list(payload.keys() or [])),
        len(payload.get("combos", []) or []),
        len(payload.get("classes", []) or []),
        len(payload.get("subjects", []) or []),
        len(payload.get("faculties", []) or []),
        payload.get("inputMode"),
        payload.get("DAYS_PER_WEEK"),
        payload.get("HOURS_PER_DAY"),
    )

    constraint_config = payload.get("constraintConfig") or {}
    debug_labs = str(os.getenv("DEBUG_LAB_ALLOCATION", "")).strip().lower() in ("1", "true", "yes", "on")
    input_mode = payload.get("inputMode", "EXPLICIT")
    
    if DEBUG:
        logger.debug("[solve_instance] Input mode: %s", input_mode)
        logger.debug("[solve_instance] Combos count: %d", len(payload.get("combos", []) or []))

    def _string_list(value: Any) -> List[str]:
        if value is None:
            return []
        if isinstance(value, list):
            return [str(item) for item in value if item is not None and str(item).strip()]
        return [str(value)] if str(value).strip() else []

    faculties = [_normalize_id(f) for f in payload.get("faculties", [])]
    subjects = [_normalize_id({**s, "type": s.get("type") or "theory"}) for s in payload.get("subjects", [])]
    classes = [_normalize_id(c) for c in payload.get("classes", [])]
    combos_raw = payload.get("combos", [])

    def _is_lab_subject(subj: Dict[str, Any]) -> bool:
        subj_type = str(subj.get("type") or "").strip().lower()
        if subj_type == "lab":
            return True
        subj_name = str(subj.get("name") or "").strip().lower()
        return "lab" in subj_name

    combos = []
    for idx, c in enumerate(combos_raw):
        subject_ref = c.get("subject")
        subject_id_value = c.get("subject_id") or c.get("subjectId")
        if not subject_id_value and isinstance(subject_ref, dict):
            subject_id_value = (
                subject_ref.get("_id")
                or subject_ref.get("id")
                or subject_ref.get("subject_id")
                or subject_ref.get("subjectId")
            )
        elif not subject_id_value and isinstance(subject_ref, (str, int)):
            subject_id_value = subject_ref

        class_ids_value = (
            c.get("class_ids")
            or c.get("classIds")
            or c.get("class_id")
            or c.get("classId")
            or c.get("class")
            or c.get("classes")
            or c.get("class_list")
        )
        faculty_ids_value = (
            c.get("faculty_ids")
            or c.get("facultyIds")
            or c.get("faculty_id")
            or c.get("facultyId")
            or c.get("teacher_ids")
            or c.get("teacherIds")
            or c.get("teacher_id")
            or c.get("teacherId")
            or c.get("teachers")
            or c.get("faculty")
            or c.get("teacher")
        )
        combo = {
            **c,
            "_id": str(c.get("_id") or c.get("id")),
            "subject_id": str(subject_id_value or ""),
            "faculty_ids": _string_list(faculty_ids_value),
            "class_ids": _string_list(class_ids_value),
        }
        combos.append(combo)

    if DEBUG:
        logger.debug("Processed combos: %d", len(combos))
        for i, combo in enumerate(combos[:5]):
            logger.debug(
                "Combo %d: %s subject=%s teachers=%s classes=%s",
                i + 1,
                combo.get("_id"),
                combo.get("subject_id"),
                combo.get("faculty_ids"),
                combo.get("class_ids"),
            )
        if len(combos) > 5:
            logger.debug("... and %d more combos", len(combos) - 5)

    DAYS_PER_WEEK = int(
        _cfg_get(constraint_config, ["schedule", "daysPerWeek"], payload.get("DAYS_PER_WEEK") or 6)
    )
    HOURS_PER_DAY = int(
        _cfg_get(constraint_config, ["schedule", "hoursPerDay"], payload.get("HOURS_PER_DAY") or 8)
    )
    BREAK_HOURS = [
        int(h) for h in (
            _cfg_get(constraint_config, ["schedule", "breakHours"], payload.get("BREAK_HOURS") or [])
        )
    ]
    break_hours_set = set(BREAK_HOURS)

    def _safe_int(value: Any) -> Optional[int]:
        try:
            return int(value)
        except Exception:
            return None

    def _class_days_per_week(class_obj: Dict[str, Any]) -> int:
        raw = class_obj.get("days_per_week")
        if raw is None:
            raw = class_obj.get("daysPerWeek")
        parsed = _safe_int(raw)
        if parsed is None or parsed <= 0:
            parsed = DAYS_PER_WEEK
        return max(1, min(int(parsed), max(1, DAYS_PER_WEEK)))

    fixed_slots = payload.get("fixed_slots") or payload.get("fixedSlots") or []
    random_seed = int(payload.get("random_seed") or os.getenv("SOLVER_RANDOM_SEED", "1"))
    solver_time_limit_sec = float(
        _cfg_get(
            constraint_config,
            ["solver", "timeLimitSec"],
            payload.get("solver_time_limit_sec") or DEFAULT_SOLVER_TIME_LIMIT_SEC,
        )
    )

    logger.info(
        "Solver configuration: daysPerWeek=%d hoursPerDay=%d breakHours=%s fixedSlots=%d seed=%d timeLimitSec=%.1f",
        DAYS_PER_WEEK,
        HOURS_PER_DAY,
        BREAK_HOURS,
        len(fixed_slots),
        random_seed,
        solver_time_limit_sec,
    )
    if DEBUG:
        logger.debug(
            "Constraint config keys: %s",
            (list(constraint_config.keys()) if constraint_config else None),
        )

    max_candidates_per_combo = int(
        _cfg_get(
            constraint_config,
            ["solver", "maxCandidatesPerCombo"],
            15,
        )
    )
    early_abort_no_solution_enabled = _to_bool(
        _cfg_get(constraint_config, ["solver", "earlyAbortNoSolution"], False),
        False,
    )
    no_solution_abort_ratio = min(
        0.95,
        max(0.0, float(_cfg_get(constraint_config, ["solver", "noSolutionAbortRatio"], 0.4))),
    )
    no_solution_abort_min_sec = max(
        1.0,
        float(_cfg_get(constraint_config, ["solver", "noSolutionAbortMinSec"], 10)),
    )

    lab_block_size = max(1, int(_cfg_get(constraint_config, ["structural", "labBlockSize"], 2)))
    theory_block_size = max(1, int(_cfg_get(constraint_config, ["structural", "theoryBlockSize"], 1)))

    weekly_hours_hard = _to_bool(
        _cfg_get(constraint_config, ["weeklySubjectHours", "hard"], False),
        False,
    )
    weekly_hours_shortage_weight = max(
        0, int(_cfg_get(constraint_config, ["weeklySubjectHours", "shortageWeight"], 1000))
    )

    teacher_cont_enabled = _to_bool(
        _cfg_get(constraint_config, ["teacherContinuity", "enabled"], False), False
    )
    teacher_cont_max = max(
        1, int(_cfg_get(constraint_config, ["teacherContinuity", "maxConsecutive"], 3))
    )
    teacher_cont_weight = max(0, int(_cfg_get(constraint_config, ["teacherContinuity", "weight"], 100)))

    class_cont_enabled = _to_bool(
        _cfg_get(constraint_config, ["classContinuity", "enabled"], False), False
    )
    class_cont_max = max(
        1, int(_cfg_get(constraint_config, ["classContinuity", "maxConsecutive"], 3))
    )
    class_cont_weight = max(0, int(_cfg_get(constraint_config, ["classContinuity", "weight"], 80)))

    no_gaps_hard = _to_bool(_cfg_get(constraint_config, ["noGaps", "hard"], False), False)  # Changed default from True to False
    no_gaps_weight = max(0, int(_cfg_get(constraint_config, ["noGaps", "weight"], 500)))

    teacher_daily_enabled = _to_bool(
        _cfg_get(constraint_config, ["teacherDailyOverload", "enabled"], True), True
    )
    teacher_daily_max = max(0, int(_cfg_get(constraint_config, ["teacherDailyOverload", "max"], 6)))
    teacher_daily_weight = max(0, int(_cfg_get(constraint_config, ["teacherDailyOverload", "weight"], 120)))
    teacher_recovery_enabled = _to_bool(
        _cfg_get(constraint_config, ["teacherRecoveryBreak", "enabled"], False), False
    )
    teacher_recovery_min_hours = max(
        0, int(_cfg_get(constraint_config, ["teacherRecoveryBreak", "minHours"], 1))
    )
    teacher_recovery_hard = _to_bool(
        _cfg_get(constraint_config, ["teacherRecoveryBreak", "hard"], False), False
    )
    teacher_recovery_weight = max(
        0, int(_cfg_get(constraint_config, ["teacherRecoveryBreak", "weight"], 140))
    )

    subject_cluster_enabled = _to_bool(
        _cfg_get(constraint_config, ["subjectClustering", "enabled"], False), False
    )
    subject_cluster_max = max(1, int(_cfg_get(constraint_config, ["subjectClustering", "maxPerDay"], 3)))
    subject_cluster_weight = max(0, int(_cfg_get(constraint_config, ["subjectClustering", "weight"], 50)))
    subject_distribution_enabled = _to_bool(
        _cfg_get(constraint_config, ["subjectDistribution", "enabled"], False), False
    )
    subject_distribution_mode = str(
        _cfg_get(constraint_config, ["subjectDistribution", "mode"], "spread")
    ).strip().lower()
    if subject_distribution_mode not in ("spread", "compact"):
        subject_distribution_mode = "spread"
    subject_distribution_weight = max(
        0, int(_cfg_get(constraint_config, ["subjectDistribution", "weight"], 70))
    )
    high_load_timing_enabled = _to_bool(
        _cfg_get(constraint_config, ["highLoadSubjectTiming", "enabled"], False), False
    )
    high_load_timing_mode = str(
        _cfg_get(constraint_config, ["highLoadSubjectTiming", "mode"], "early")
    ).strip().lower()
    if high_load_timing_mode not in ("early", "late"):
        high_load_timing_mode = "early"
    high_load_timing_min_hours = max(
        1, int(_cfg_get(constraint_config, ["highLoadSubjectTiming", "minHoursPerWeek"], 4))
    )
    high_load_timing_weight = max(
        0, int(_cfg_get(constraint_config, ["highLoadSubjectTiming", "weight"], 60))
    )

    daily_compactness_enabled = _to_bool(
        _cfg_get(
            constraint_config,
            ["dailyCompactness", "enabled"],
            False,
        ),
        False,
    )
    daily_compactness_weight = max(
        0,
        int(
            _cfg_get(
                constraint_config,
                ["dailyCompactness", "weight"],
                400,
            )
        ),
    )
    daily_compactness_transition_weight = max(
        0,
        int(
            _cfg_get(
                constraint_config,
                ["dailyCompactness", "transitionWeight"],
                daily_compactness_weight,
            )
        ),
    )
    daily_compactness_empty_before_later_weight = max(
        0,
        int(
            _cfg_get(
                constraint_config,
                ["dailyCompactness", "emptyBeforeLaterOccupiedWeight"],
                daily_compactness_weight,
            )
        ),
    )
    daily_compactness_late_slot_weight = max(
        0,
        int(
            _cfg_get(
                constraint_config,
                ["dailyCompactness", "lateSlotWeight"],
                daily_compactness_weight,
            )
        ),
    )
    weekly_front_loading_enabled = _to_bool(
        _cfg_get(
            constraint_config,
            ["weeklyFrontLoading", "enabled"],
            _cfg_get(constraint_config, ["frontLoading", "enabled"], False),
        ),
        False,
    )
    weekly_front_loading_weight = max(
        0,
        int(
            _cfg_get(
                constraint_config,
                ["weeklyFrontLoading", "weight"],
                _cfg_get(constraint_config, ["frontLoading", "weight"], 400),
            )
        ),
    )
    weekly_front_loading_transition_weight = max(
        0,
        int(
            _cfg_get(
                constraint_config,
                ["weeklyFrontLoading", "transitionWeight"],
                weekly_front_loading_weight,
            )
        ),
    )
    weekly_front_loading_empty_before_later_weight = max(
        0,
        int(
            _cfg_get(
                constraint_config,
                ["weeklyFrontLoading", "emptyBeforeLaterOccupiedWeight"],
                weekly_front_loading_weight,
            )
        ),
    )
    weekly_front_loading_late_slot_weight = max(
        0,
        int(
            _cfg_get(
                constraint_config,
                ["weeklyFrontLoading", "lateSlotWeight"],
                weekly_front_loading_weight,
            )
        ),
    )
    weekly_balance_enabled = _to_bool(
        _cfg_get(constraint_config, ["weeklyBalance", "enabled"], False), False
    )
    weekly_balance_weight = max(
        0, int(_cfg_get(constraint_config, ["weeklyBalance", "weight"], 140))
    )

    teacher_avail_enabled = _to_bool(
        _cfg_get(constraint_config, ["teacherAvailability", "enabled"], False), False
    )
    teacher_avail_hard = _to_bool(
        _cfg_get(constraint_config, ["teacherAvailability", "hard"], False), False  # Changed default from True to False
    )
    teacher_avail_weight = max(
        0, int(_cfg_get(constraint_config, ["teacherAvailability", "weight"], 250))
    )
    teacher_avail_global = set(
        _normalize_slot_list(
            _cfg_get(constraint_config, ["teacherAvailability", "globallyUnavailableSlots"], [])
        )
    )
    teacher_avail_by_teacher = _normalize_teacher_slot_map(
        _cfg_get(constraint_config, ["teacherAvailability", "unavailableSlotsByTeacher"], {})
    )

    teacher_weekly_enabled = _to_bool(
        _cfg_get(constraint_config, ["teacherWeeklyLoadBalance", "enabled"], False), False
    )
    teacher_weekly_min = max(
        0, int(_cfg_get(constraint_config, ["teacherWeeklyLoadBalance", "minWeeklyLoad"], 0))
    )
    teacher_weekly_target = max(
        0, int(_cfg_get(constraint_config, ["teacherWeeklyLoadBalance", "targetWeeklyLoad"], 0))
    )
    teacher_weekly_max = max(
        0, int(_cfg_get(constraint_config, ["teacherWeeklyLoadBalance", "maxWeeklyLoad"], 48))
    )
    teacher_weekly_hard_min = _to_bool(
        _cfg_get(constraint_config, ["teacherWeeklyLoadBalance", "hardMin"], False), False
    )
    teacher_weekly_hard_max = _to_bool(
        _cfg_get(constraint_config, ["teacherWeeklyLoadBalance", "hardMax"], False), False
    )
    teacher_weekly_under_weight = max(
        0, int(_cfg_get(constraint_config, ["teacherWeeklyLoadBalance", "underWeight"], 40))
    )
    teacher_weekly_over_weight = max(
        0, int(_cfg_get(constraint_config, ["teacherWeeklyLoadBalance", "overWeight"], 40))
    )

    class_daily_min_enabled = _to_bool(
        _cfg_get(constraint_config, ["classDailyMinimumLoad", "enabled"], False), False
    )
    class_daily_min_hard = _to_bool(
        _cfg_get(constraint_config, ["classDailyMinimumLoad", "hard"], False), False
    )
    class_daily_min_value = max(
        0, int(_cfg_get(constraint_config, ["classDailyMinimumLoad", "minPerDay"], 1))
    )
    class_daily_min_weight = max(
        0, int(_cfg_get(constraint_config, ["classDailyMinimumLoad", "weight"], 100))
    )

    teacher_boundary_enabled = _to_bool(
        _cfg_get(constraint_config, ["teacherBoundaryPreference", "enabled"], False), False
    )
    teacher_boundary_avoid_first = _to_bool(
        _cfg_get(constraint_config, ["teacherBoundaryPreference", "avoidFirstPeriod"], True), True
    )
    teacher_boundary_avoid_last = _to_bool(
        _cfg_get(constraint_config, ["teacherBoundaryPreference", "avoidLastPeriod"], True), True
    )
    teacher_boundary_weight = max(
        0, int(_cfg_get(constraint_config, ["teacherBoundaryPreference", "weight"], 60))
    )
    teacher_boundary_overrides_raw = _cfg_get(
        constraint_config, ["teacherBoundaryPreference", "teacherOverrides"], {}
    )
    teacher_boundary_overrides = (
        teacher_boundary_overrides_raw if isinstance(teacher_boundary_overrides_raw, dict) else {}
    )
    teacher_preferences = _normalize_teacher_preferences_map(
        payload.get("teacherPreferences")
        or _cfg_get(constraint_config, ["teacherPreferences"], {})
    )
    teacher_pref_avoid_first_weight = 40
    teacher_pref_avoid_last_weight = 40
    teacher_pref_non_preferred_day_weight = 20
    teacher_pref_max_consecutive_weight = 80
    no_teacher_early_slot_weight = max(
        0, int(_cfg_get(constraint_config, ["noTeacherSessions", "earlySlotWeight"], 40))
    )

    applied_config = {
        "schedule": {"daysPerWeek": DAYS_PER_WEEK, "hoursPerDay": HOURS_PER_DAY, "breakHours": BREAK_HOURS},
        "structural": {"labBlockSize": lab_block_size, "theoryBlockSize": theory_block_size},
        "weeklySubjectHours": {"hard": weekly_hours_hard, "shortageWeight": weekly_hours_shortage_weight},
        "teacherContinuity": {"enabled": teacher_cont_enabled, "maxConsecutive": teacher_cont_max, "weight": teacher_cont_weight},
        "classContinuity": {"enabled": class_cont_enabled, "maxConsecutive": class_cont_max, "weight": class_cont_weight},
        "noGaps": {"hard": no_gaps_hard, "weight": no_gaps_weight},
        "teacherDailyOverload": {"enabled": teacher_daily_enabled, "max": teacher_daily_max, "weight": teacher_daily_weight},
        "teacherRecoveryBreak": {
            "enabled": teacher_recovery_enabled,
            "minHours": teacher_recovery_min_hours,
            "hard": teacher_recovery_hard,
            "weight": teacher_recovery_weight,
        },
        "subjectClustering": {"enabled": subject_cluster_enabled, "maxPerDay": subject_cluster_max, "weight": subject_cluster_weight},
        "subjectDistribution": {
            "enabled": subject_distribution_enabled,
            "mode": subject_distribution_mode,
            "weight": subject_distribution_weight,
        },
        "highLoadSubjectTiming": {
            "enabled": high_load_timing_enabled,
            "mode": high_load_timing_mode,
            "minHoursPerWeek": high_load_timing_min_hours,
            "weight": high_load_timing_weight,
        },
        "dailyCompactness": {
            "enabled": daily_compactness_enabled,
            "weight": daily_compactness_weight,
            "transitionWeight": daily_compactness_transition_weight,
            "emptyBeforeLaterOccupiedWeight": daily_compactness_empty_before_later_weight,
            "lateSlotWeight": daily_compactness_late_slot_weight,
        },
        "weeklyFrontLoading": {
            "enabled": weekly_front_loading_enabled,
            "weight": weekly_front_loading_weight,
            "transitionWeight": weekly_front_loading_transition_weight,
            "emptyBeforeLaterOccupiedWeight": weekly_front_loading_empty_before_later_weight,
            "lateSlotWeight": weekly_front_loading_late_slot_weight,
        },
        "frontLoading": {
            "enabled": weekly_front_loading_enabled,
            "weight": weekly_front_loading_weight,
            "transitionWeight": weekly_front_loading_transition_weight,
            "emptyBeforeLaterOccupiedWeight": weekly_front_loading_empty_before_later_weight,
            "lateSlotWeight": weekly_front_loading_late_slot_weight,
        },
        "weeklyBalance": {
            "enabled": weekly_balance_enabled,
            "weight": weekly_balance_weight,
        },
        "teacherAvailability": {
            "enabled": teacher_avail_enabled,
            "hard": teacher_avail_hard,
            "weight": teacher_avail_weight,
            "globallyUnavailableSlots": [
                {"day": day, "hour": hour} for (day, hour) in sorted(teacher_avail_global)
            ],
            "unavailableSlotsByTeacher": {
                tid: [{"day": day, "hour": hour} for (day, hour) in sorted(list(slots))]
                for tid, slots in teacher_avail_by_teacher.items()
            },
        },
        "teacherWeeklyLoadBalance": {
            "enabled": teacher_weekly_enabled,
            "minWeeklyLoad": teacher_weekly_min,
            "targetWeeklyLoad": teacher_weekly_target,
            "maxWeeklyLoad": teacher_weekly_max,
            "hardMin": teacher_weekly_hard_min,
            "hardMax": teacher_weekly_hard_max,
            "underWeight": teacher_weekly_under_weight,
            "overWeight": teacher_weekly_over_weight,
        },
        "classDailyMinimumLoad": {
            "enabled": class_daily_min_enabled,
            "hard": class_daily_min_hard,
            "minPerDay": class_daily_min_value,
            "weight": class_daily_min_weight,
        },
        "teacherBoundaryPreference": {
            "enabled": teacher_boundary_enabled,
            "avoidFirstPeriod": teacher_boundary_avoid_first,
            "avoidLastPeriod": teacher_boundary_avoid_last,
            "weight": teacher_boundary_weight,
            "teacherOverrides": teacher_boundary_overrides,
        },
        "teacherPreferences": teacher_preferences,
        "noTeacherSessions": {"earlySlotWeight": no_teacher_early_slot_weight},
        "solver": {
            "timeLimitSec": solver_time_limit_sec,
            "solutionCount": int(_cfg_get(constraint_config, ["solver", "solutionCount"], DEFAULT_SOLUTION_COUNT)),
            "maxCandidatesPerCombo": max_candidates_per_combo,
            "earlyAbortNoSolution": early_abort_no_solution_enabled,
            "noSolutionAbortRatio": no_solution_abort_ratio,
            "noSolutionAbortMinSec": no_solution_abort_min_sec,
            "minTimePerAttemptSec": float(_cfg_get(constraint_config, ["solver", "minTimePerAttemptSec"], 15)),
            "minCandidateDifferenceRatio": float(
                _cfg_get(constraint_config, ["solver", "minCandidateDifferenceRatio"], 0.02)
            ),
        },
    }

    subject_by_id = {s["_id"]: s for s in subjects}
    class_by_id = {c["_id"]: c for c in classes}
    combo_by_id = {c["_id"]: c for c in combos}
    faculty_by_id = {f["_id"]: f for f in faculties}
    faculty_ids = [f["_id"] for f in faculties]

    def _is_teacher_unavailable(fid: str, day: int, hour: int) -> bool:
        key = (day, hour)
        if key in teacher_avail_global:
            return True
        teacher_slots = teacher_avail_by_teacher.get(fid)
        return bool(teacher_slots and key in teacher_slots)

    required_hours_by_class_subject: Dict[str, Dict[str, int]] = {}
    for cls in classes:
        cid = cls["_id"]
        required_hours_by_class_subject[cid] = {}
        for subj in subjects:
            required_hours_by_class_subject[cid][subj["_id"]] = _required_hours(
                cls, subj
            )
    required_total_hours_by_class: Dict[str, int] = {
        cid: sum(subject_hours.values())
        for cid, subject_hours in required_hours_by_class_subject.items()
    }
    if debug_labs:
        target_subjects = {
            subj["_id"]: subj.get("name")
            for subj in subjects
            if "lab" in str(subj.get("name") or "").lower() or str(subj.get("type") or "").lower() == "lab"
        }
        logger.debug(
            "[solve_instance] payload summary %s",
            {
                "classes": len(classes),
                "subjects": len(subjects),
                "combos": len(combos),
                "labSubjects": target_subjects,
            },
        )
        for cls in classes:
            class_id = cls["_id"]
            combo_ids = [
                combo["_id"]
                for combo in combos
                if class_id in [str(cid) for cid in (combo.get("class_ids") or [])]
            ]
            logger.debug(
                "[solve_instance] class combos %s",
                {
                    "classId": class_id,
                    "className": cls.get("name") or class_id,
                    "comboCount": len(combo_ids),
                    "comboIds": combo_ids[:20],
                },
            )
        for combo in combos:
            combo_subject = subject_by_id.get(combo.get("subject_id"))
            combo_subject_type = str(combo_subject.get("type") or "").lower() if combo_subject else ""
            if combo_subject_type != "lab":
                continue
            logger.debug(
                "[solve_instance] lab combo normalized %s",
                {
                    "comboId": combo.get("_id"),
                    "subjectId": combo.get("subject_id"),
                    "subjectName": (combo_subject.get("name") if combo_subject else None)
                    or combo.get("subject_id"),
                    "classIds": combo.get("class_ids", []),
                    "facultyIds": combo.get("faculty_ids", []),
                    "rawKeys": sorted(list(combo.keys()))[:40],
                },
            )

    # Validate fixed slots early (non-fatal): keep only valid ones and continue.
    valid_fixed_slots: List[Dict[str, Any]] = []
    fixed_slot_warnings: List[str] = []
    for fs in fixed_slots:
        class_id = str(fs.get("class"))
        combo_id = str(fs.get("combo"))
        try:
            day = int(fs.get("day"))
            hour = int(fs.get("hour"))
        except Exception:
            fixed_slot_warnings.append(f"Fixed slot has non-numeric day/hour: {fs}")
            continue

        if class_id not in class_by_id:
            fixed_slot_warnings.append(f"Fixed slot class not found: {class_id}")
            continue
        if combo_id not in combo_by_id:
            fixed_slot_warnings.append(f"Fixed slot combo not found: {combo_id}")
            continue
        if day < 0 or day >= _class_days_per_week(class_by_id[class_id]):
            fixed_slot_warnings.append(
                f"Fixed slot day out of range for class {class_id}: {day}"
            )
            continue
        if hour < 0 or hour >= HOURS_PER_DAY:
            fixed_slot_warnings.append(f"Fixed slot hour out of range: {hour}")
            continue
        if hour in break_hours_set:
            fixed_slot_warnings.append(
                f"Fixed slot falls in break hour for class {class_id} at {day},{hour}"
            )
            continue
        combo = combo_by_id.get(combo_id)
        combo_class_ids = combo.get("class_ids", []) if combo else []
        if combo and combo_class_ids and class_id not in combo_class_ids:
            fixed_slot_warnings.append(
                f"Fixed slot class {class_id} is not part of combo {combo_id}"
            )
            continue
        if combo and any(
            day >= _class_days_per_week(class_by_id[cid])
            for cid in combo_class_ids
            if cid in class_by_id
        ):
            fixed_slot_warnings.append(
                f"Fixed slot day out of range for one or more classes in combo {combo_id}: {day}"
            )
            continue
        if teacher_avail_enabled and teacher_avail_hard:
            if combo:
                subj = subject_by_id.get(combo.get("subject_id"))
                block = lab_block_size if subj and _is_lab_subject(subj) else theory_block_size
                availability_conflict = False
                for fid in combo.get("faculty_ids", []):
                    if any(_is_teacher_unavailable(fid, day, h) for h in range(hour, min(HOURS_PER_DAY, hour + block))):
                        availability_conflict = True
                        break
                if availability_conflict:
                    fixed_slot_warnings.append(
                        f"Fixed slot violates teacher availability for class {class_id} at {day},{hour}"
                    )
                    continue
        valid_fixed_slots.append(
            {"class": class_id, "day": day, "hour": hour, "combo": combo_id}
        )

    model = cp_model.CpModel()

    # Decision variables: start placement per combo/day/hour.
    x: Dict[Tuple[str, int, int], cp_model.IntVar] = {}
    covers: Dict[Tuple[str, int, int], List[cp_model.IntVar]] = {}
    teacher_covers: Dict[Tuple[str, int, int], List[cp_model.IntVar]] = {}
    subject_covers: Dict[Tuple[str, int, int, str], List[cp_model.IntVar]] = {}
    unmet_requirements: List[Dict[str, Any]] = []
    objective_terms: List[cp_model.LinearExpr] = []
    valid_hours = [h for h in range(HOURS_PER_DAY) if h not in break_hours_set]
    hour_rank = {h: i for i, h in enumerate(valid_hours)}
    valid_hour_count = len(valid_hours)
    fixed_slot_keys = {
        (str(fs.get("combo")), int(fs.get("day")), int(fs.get("hour")))
        for fs in valid_fixed_slots
    }
    combo_candidate_starts: Dict[str, List[Tuple[int, int]]] = {}
    combo_search_rank: Dict[str, int] = {}
    class_slot_pressure: Dict[Tuple[str, int, int], int] = {}
    teacher_slot_pressure: Dict[Tuple[str, int, int], int] = {}

    for combo in combos:
        combo_id = combo["_id"]
        class_ids = [cid for cid in (combo.get("class_ids") or []) if cid in class_by_id]
        if not class_ids:
            if DEBUG:
                logger.debug("[solve_instance] Skipping combo %s: no valid class_ids", combo_id)
            continue
        subj_ref = combo.get("subject")
        subj = (subj_ref if isinstance(subj_ref, dict) else None) or subject_by_id.get(combo.get("subject_id"))
        if not subj:
            if DEBUG:
                logger.debug(
                    "[solve_instance] Skipping combo %s: subject %s not found",
                    combo_id,
                    combo.get("subject_id"),
                )
            continue
        required_hours_list = [required_hours_by_class_subject[cid].get(combo["subject_id"], 0) for cid in class_ids]
        if all(h <= 0 for h in required_hours_list):
            if DEBUG:
                logger.debug(
                    "[solve_instance] Skipping combo %s: no required hours (classes=%s subject=%s hours=%s)",
                    combo_id,
                    class_ids,
                    combo.get("subject_id"),
                    required_hours_list,
                )
            continue
        block = lab_block_size if _is_lab_subject(subj) else theory_block_size
        max_days_for_combo = min(
            [_class_days_per_week(class_by_id[cid]) for cid in class_ids] or [DAYS_PER_WEEK]
        )
        candidate_starts: List[Tuple[int, int]] = []
        rejected_break = 0
        rejected_overflow = 0
        rejected_split_break = 0
        for day in range(max_days_for_combo):
            for hour in range(HOURS_PER_DAY):
                if hour in break_hours_set:
                    rejected_break += 1
                    continue
                if hour + block > HOURS_PER_DAY:
                    rejected_overflow += 1
                    continue
                if any(h in break_hours_set for h in range(hour, hour + block)):
                    rejected_split_break += 1
                    continue

                candidate_starts.append((day, hour))

        if debug_labs and _is_lab_subject(subj):
            logger.debug(
                "[solve_instance] lab candidate scan %s",
                {
                    "comboId": combo_id,
                    "subjectId": combo["subject_id"],
                    "subjectName": subj.get("name") or combo["subject_id"],
                    "classIds": class_ids,
                    "facultyIds": combo.get("faculty_ids", []),
                    "block": block,
                    "daysPerWeek": max_days_for_combo,
                    "hoursPerDay": HOURS_PER_DAY,
                    "breakHours": sorted(list(break_hours_set)),
                    "candidateCount": len(candidate_starts),
                    "rejectedBreakStarts": rejected_break,
                    "rejectedOverflowStarts": rejected_overflow,
                    "rejectedSplitBreakStarts": rejected_split_break,
                    "sampleCandidates": candidate_starts[:20],
                    "requiredHours": {
                        cid: required_hours_by_class_subject.get(cid, {}).get(combo["subject_id"], 0)
                        for cid in class_ids
                    },
                },
            )

        if not candidate_starts:
            if DEBUG:
                logger.debug(
                    "[solve_instance] Skipping combo %s: no candidate starts (block=%d days=%d)",
                    combo_id,
                    block,
                    max_days_for_combo,
                )
            continue

        combo_candidate_starts[combo_id] = candidate_starts
        for day, hour in candidate_starts:
            for h in range(hour, hour + block):
                for class_id in class_ids:
                    key = (class_id, day, h)
                    class_slot_pressure[key] = class_slot_pressure.get(key, 0) + 1
                for fid in combo.get("faculty_ids", []):
                    key = (fid, day, h)
                    teacher_slot_pressure[key] = teacher_slot_pressure.get(key, 0) + 1

        required_hours = min(
            [required_hours_by_class_subject[cid].get(combo["subject_id"], 0) for cid in class_ids] or [0]
        )
        availability_slots = sum(
            1
            for fid in combo.get("faculty_ids", [])
            for day, hour in candidate_starts
            if any(_is_teacher_unavailable(fid, day, h) for h in range(hour, hour + block))
        )
        fixed_bonus = sum(
            1 for day, hour in candidate_starts if (combo_id, day, hour) in fixed_slot_keys
        )
        is_lab = _is_lab_subject(subj)
        combo_search_rank[combo_id] = (
            (10000 if is_lab else 0)
            + (9000 if fixed_bonus > 0 else 0)
            + (7000 if len(class_ids) > 1 else 0)
            + (6000 if len(combo.get("faculty_ids", [])) <= 1 else 0)
            + (required_hours * 200)
            + (availability_slots * 25)
            - (len(candidate_starts) * 10)
        )

    sorted_combos = sorted(
        combos,
        key=lambda combo: (
            -combo_search_rank.get(combo["_id"], -10**9),
            len(combo_candidate_starts.get(combo["_id"], [])),
            combo["_id"],
        ),
    )

    search_ordered_vars: List[cp_model.IntVar] = []
    for combo in sorted_combos:
        combo_id = combo["_id"]
        class_ids = [cid for cid in (combo.get("class_ids") or []) if cid in class_by_id]
        candidate_starts = combo_candidate_starts.get(combo_id, [])
        subj_ref = combo.get("subject")
        subj = (subj_ref if isinstance(subj_ref, dict) else None) or subject_by_id.get(combo.get("subject_id"))
        if not class_ids or not candidate_starts:
            if debug_labs and subj and _is_lab_subject(subj):
                logger.debug(
                    "[solve_instance] skipping lab combo during search %s",
                    {
                        "comboId": combo_id,
                        "subjectId": combo["subject_id"],
                        "subjectName": subj.get("name") or combo["subject_id"],
                        "classIds": class_ids,
                        "candidateStarts": len(candidate_starts),
                    },
                )
            continue
        if not subj:
            continue
        block = lab_block_size if _is_lab_subject(subj) else theory_block_size
        ordered_starts = sorted(
            candidate_starts,
            key=lambda slot: (
                -int((combo_id, slot[0], slot[1]) in fixed_slot_keys),
                -sum(
                    class_slot_pressure.get((class_id, slot[0], h), 0)
                    for h in range(slot[1], slot[1] + block)
                    for class_id in class_ids
                ),
                -sum(
                    teacher_slot_pressure.get((fid, slot[0], h), 0)
                    for h in range(slot[1], slot[1] + block)
                    for fid in combo.get("faculty_ids", [])
                ),
                slot[0],
                hour_rank.get(slot[1], slot[1]),
            ),
        )
        # Ensure labs have a full search space regardless of global limits
        actual_max = 0 if _is_lab_subject(subj) else max_candidates_per_combo
        if actual_max > 0 and len(ordered_starts) > actual_max:
            fixed_starts = [
                slot for slot in ordered_starts if (combo_id, slot[0], slot[1]) in fixed_slot_keys
            ]
            non_fixed_starts = [
                slot for slot in ordered_starts if (combo_id, slot[0], slot[1]) not in fixed_slot_keys
            ]
            remaining_capacity = max(0, actual_max - len(fixed_starts))
            ordered_starts = fixed_starts + non_fixed_starts[:remaining_capacity]
        for day, hour in ordered_starts:
            violates_availability = False
            if teacher_avail_enabled:
                for fid in combo.get("faculty_ids", []):
                    if any(_is_teacher_unavailable(fid, day, h) for h in range(hour, hour + block)):
                        violates_availability = True
                        break

            var = model.NewBoolVar(f"x_{combo_id}_{day}_{hour}")
            x[(combo_id, day, hour)] = var
            search_ordered_vars.append(var)
            if (
                teacher_avail_enabled
                and not teacher_avail_hard
                and teacher_avail_weight > 0
                and violates_availability
            ):
                objective_terms.append(var * teacher_avail_weight)
            if (
                no_teacher_early_slot_weight > 0
                and str(subj.get("type") or "").lower() == "no_teacher"
                and valid_hour_count > 0
            ):
                slot_rank = hour_rank.get(hour, 0)
                early_penalty = max(0, valid_hour_count - slot_rank - 1)
                if early_penalty > 0:
                    objective_terms.append(var * no_teacher_early_slot_weight * early_penalty)

            for h in range(hour, hour + block):
                for class_id in class_ids:
                    covers.setdefault((class_id, day, h), []).append(var)
                    subject_covers.setdefault((class_id, day, h, combo["subject_id"]), []).append(var)
                for fid in combo.get("faculty_ids", []):
                    teacher_covers.setdefault((fid, day, h), []).append(var)

    # Constraint: at most one lesson per class per hour
    for cls in classes:
        class_id = cls["_id"]
        days = _class_days_per_week(cls)
        for day in range(days):
            for hour in range(HOURS_PER_DAY):
                if hour in break_hours_set:
                    continue
                vars_here = covers.get((class_id, day, hour), [])
                if vars_here:
                    model.AddAtMostOne(vars_here)

    # Constraint: teacher clash
    for fid in faculty_ids:
        for day in range(DAYS_PER_WEEK):
            for hour in range(HOURS_PER_DAY):
                if hour in break_hours_set:
                    continue
                vars_here = teacher_covers.get((fid, day, hour), [])
                if vars_here:
                    model.AddAtMostOne(vars_here)

    # Occupancy variables per class and faculty per slot (0/1)
    class_occ: Dict[Tuple[str, int, int], cp_model.IntVar] = {}
    for cls in classes:
        class_id = cls["_id"]
        days = _class_days_per_week(cls)
        for day in range(days):
            for hour in range(HOURS_PER_DAY):
                if hour in break_hours_set:
                    continue
                occ = model.NewBoolVar(f"class_occ_{class_id}_{day}_{hour}")
                vars_here = covers.get((class_id, day, hour), [])
                if vars_here:
                    model.Add(occ == sum(vars_here))
                else:
                    model.Add(occ == 0)
                class_occ[(class_id, day, hour)] = occ

    teacher_occ: Dict[Tuple[str, int, int], cp_model.IntVar] = {}
    for fid in faculty_ids:
        for day in range(DAYS_PER_WEEK):
            for hour in range(HOURS_PER_DAY):
                if hour in break_hours_set:
                    continue
                occ = model.NewBoolVar(f"teacher_occ_{fid}_{day}_{hour}")
                vars_here = teacher_covers.get((fid, day, hour), [])
                if vars_here:
                    model.Add(occ == sum(vars_here))
                else:
                    model.Add(occ == 0)
                teacher_occ[(fid, day, hour)] = occ

    # Weekly subject hours: configurable hard/soft behavior.
    x_by_class_subject: Dict[Tuple[str, str], List[Tuple[cp_model.IntVar, int]]] = {}
    for (combo_id, _day, _hour), var in x.items():
        combo = combo_by_id.get(combo_id)
        if not combo:
            continue
        subj_ref = combo.get("subject")
        subj = (subj_ref if isinstance(subj_ref, dict) else None) or subject_by_id.get(combo.get("subject_id"))
        if not subj:
            continue
        block = lab_block_size if _is_lab_subject(subj) else theory_block_size
        for class_id in combo.get("class_ids", []):
            x_by_class_subject.setdefault((class_id, combo["subject_id"]), []).append(
                (var, block)
            )

    def _build_failure_diagnostics() -> Dict[str, Any]:
        active_combo_ids_by_pair: Dict[Tuple[str, str], set] = {}
        active_start_count_by_pair: Dict[Tuple[str, str], int] = {}
        teacher_hours_demand: Dict[str, int] = {}
        teacher_pair_coverage_count: Dict[str, int] = {}
        pair_teacher_sets: Dict[Tuple[str, str], set] = {}
        for combo_id, day, hour in x.keys():
            combo = combo_by_id.get(combo_id)
            if not combo:
                continue
            subject_id = combo.get("subject_id")
            for class_id in combo.get("class_ids", []):
                key = (class_id, subject_id)
                active_combo_ids_by_pair.setdefault(key, set()).add(combo_id)
                active_start_count_by_pair[key] = active_start_count_by_pair.get(key, 0) + 1

        required_pair_count = 0
        zero_start_requirements: List[Dict[str, Any]] = []
        low_flex_requirements: List[Dict[str, Any]] = []
        teacher_forced_hours: Dict[str, int] = {}

        for cls in classes:
            class_id = cls["_id"]
            for subj in subjects:
                subject_id = subj["_id"]
                req = int(required_hours_by_class_subject[class_id].get(subject_id, 0) or 0)
                if req <= 0:
                    continue
                required_pair_count += 1
                pair_key = (class_id, subject_id)
                combo_ids = sorted(active_combo_ids_by_pair.get(pair_key) or [])
                start_count = int(active_start_count_by_pair.get(pair_key, 0) or 0)
                item = {
                    "classId": class_id,
                    "className": class_by_id.get(class_id, {}).get("name") or class_id,
                    "subjectId": subject_id,
                    "subjectName": subject_by_id.get(subject_id, {}).get("name") or subject_id,
                    "requiredHours": req,
                    "eligibleComboCount": len(combo_ids),
                    "eligibleStartCount": start_count,
                }
                if start_count == 0 or not combo_ids:
                    zero_start_requirements.append(item)
                    continue
                if start_count <= max(req, 2) or len(combo_ids) <= 1:
                    low_flex_requirements.append(item)

                teacher_sets = []
                for combo_id in combo_ids:
                    combo = combo_by_id.get(combo_id) or {}
                    teacher_sets.append(set(str(fid) for fid in (combo.get("faculty_ids") or [])))
                union_teachers = set().union(*teacher_sets) if teacher_sets else set()
                pair_teacher_sets[pair_key] = union_teachers
                item["eligibleTeacherCount"] = len(union_teachers)
                if teacher_sets:
                    common_teachers = set.intersection(*teacher_sets)
                    for fid in common_teachers:
                        if fid:
                            teacher_forced_hours[fid] = teacher_forced_hours.get(fid, 0) + req
                    for fid in union_teachers:
                        if fid:
                            teacher_hours_demand[fid] = teacher_hours_demand.get(fid, 0) + req
                            teacher_pair_coverage_count[fid] = teacher_pair_coverage_count.get(fid, 0) + 1

        teacher_capacity_pressure: List[Dict[str, Any]] = []
        teacher_demand_pressure: List[Dict[str, Any]] = []
        for fid, forced_hours in teacher_forced_hours.items():
            unavailable_count = 0
            if teacher_avail_enabled and teacher_avail_hard:
                seen_slots = set(teacher_avail_global)
                teacher_slots = teacher_avail_by_teacher.get(fid) or set()
                seen_slots |= set(teacher_slots)
                unavailable_count = len(
                    {
                        (day, hour)
                        for (day, hour) in seen_slots
                        if 0 <= day < DAYS_PER_WEEK and 0 <= hour < HOURS_PER_DAY and hour not in break_hours_set
                    }
                )
            capacity = max(0, DAYS_PER_WEEK * valid_hour_count - unavailable_count)
            ratio = (forced_hours / capacity) if capacity > 0 else None
            teacher_capacity_pressure.append(
                {
                    "teacherId": fid,
                    "teacherName": faculty_by_id.get(fid, {}).get("name") or fid,
                    "forcedHours": forced_hours,
                    "effectiveCapacity": capacity,
                    "utilizationRatio": ratio,
                }
            )

        for fid, demand_hours in teacher_hours_demand.items():
            unavailable_count = 0
            if teacher_avail_enabled and teacher_avail_hard:
                seen_slots = set(teacher_avail_global)
                teacher_slots = teacher_avail_by_teacher.get(fid) or set()
                seen_slots |= set(teacher_slots)
                unavailable_count = len(
                    {
                        (day, hour)
                        for (day, hour) in seen_slots
                        if 0 <= day < DAYS_PER_WEEK and 0 <= hour < HOURS_PER_DAY and hour not in break_hours_set
                    }
                )
            capacity = max(0, DAYS_PER_WEEK * valid_hour_count - unavailable_count)
            teacher_demand_pressure.append(
                {
                    "teacherId": fid,
                    "teacherName": faculty_by_id.get(fid, {}).get("name") or fid,
                    "demandHours": demand_hours,
                    "coveredPairs": teacher_pair_coverage_count.get(fid, 0),
                    "effectiveCapacity": capacity,
                    "demandToCapacityRatio": (demand_hours / capacity) if capacity > 0 else None,
                }
            )

        teacher_capacity_pressure.sort(
            key=lambda item: (
                -999999 if item.get("effectiveCapacity") == 0 and item.get("forcedHours", 0) > 0
                else -(item.get("utilizationRatio") or 0),
                -(item.get("forcedHours") or 0),
                item.get("teacherName") or "",
            )
        )
        teacher_demand_pressure.sort(
            key=lambda item: (
                -999999 if item.get("effectiveCapacity") == 0 and item.get("demandHours", 0) > 0
                else -(item.get("demandToCapacityRatio") or 0),
                -(item.get("demandHours") or 0),
                -(item.get("coveredPairs") or 0),
                item.get("teacherName") or "",
            )
        )
        low_flex_requirements.sort(
            key=lambda item: (
                item.get("eligibleStartCount", 0),
                item.get("eligibleComboCount", 0),
                item.get("eligibleTeacherCount", 0),
                -item.get("requiredHours", 0),
                item.get("className") or "",
                item.get("subjectName") or "",
            )
        )

        pair_teacher_contention: List[Dict[str, Any]] = []
        pair_items = []
        for cls in classes:
            class_id = cls["_id"]
            for subj in subjects:
                subject_id = subj["_id"]
                req = int(required_hours_by_class_subject[class_id].get(subject_id, 0) or 0)
                if req <= 0:
                    continue
                pair_key = (class_id, subject_id)
                teacher_ids = set(pair_teacher_sets.get(pair_key) or set())
                if not teacher_ids:
                    continue
                pair_items.append(
                    {
                        "pairKey": pair_key,
                        "classId": class_id,
                        "className": class_by_id.get(class_id, {}).get("name") or class_id,
                        "subjectId": subject_id,
                        "subjectName": subject_by_id.get(subject_id, {}).get("name") or subject_id,
                        "requiredHours": req,
                        "teacherIds": teacher_ids,
                    }
                )

        for index, left in enumerate(pair_items):
            for right in pair_items[index + 1 :]:
                shared_teachers = sorted(left["teacherIds"] & right["teacherIds"])
                if not shared_teachers:
                    continue
                pair_teacher_contention.append(
                    {
                        "leftClassName": left["className"],
                        "leftSubjectName": left["subjectName"],
                        "leftRequiredHours": left["requiredHours"],
                        "rightClassName": right["className"],
                        "rightSubjectName": right["subjectName"],
                        "rightRequiredHours": right["requiredHours"],
                        "sharedTeacherCount": len(shared_teachers),
                        "sharedTeachers": [
                            faculty_by_id.get(fid, {}).get("name") or fid for fid in shared_teachers[:5]
                        ],
                        "combinedRequiredHours": left["requiredHours"] + right["requiredHours"],
                    }
                )

        pair_teacher_contention.sort(
            key=lambda item: (
                -item.get("sharedTeacherCount", 0),
                -item.get("combinedRequiredHours", 0),
                item.get("leftClassName") or "",
                item.get("rightClassName") or "",
            )
        )

        return {
            "summary": {
                "requiredClassSubjectPairs": required_pair_count,
                "zeroStartRequirementCount": len(zero_start_requirements),
                "lowFlexRequirementCount": len(low_flex_requirements),
                "teacherForcedPressureCount": len(
                    [item for item in teacher_capacity_pressure if (item.get("utilizationRatio") or 0) >= 0.85]
                ),
                "teacherDemandPressureCount": len(
                    [item for item in teacher_demand_pressure if (item.get("demandToCapacityRatio") or 0) >= 1.0]
                ),
                "pairTeacherContentionCount": len(pair_teacher_contention),
            },
            "zeroStartRequirements": zero_start_requirements[:20],
            "lowFlexRequirements": low_flex_requirements[:20],
            "teacherForcedPressure": teacher_capacity_pressure[:20],
            "teacherDemandPressure": teacher_demand_pressure[:20],
            "pairTeacherContention": pair_teacher_contention[:20],
            "fixedSlotWarnings": fixed_slot_warnings[:20],
        }

    def _build_partial_preview() -> Dict[str, Any]:
        max_days = max([_class_days_per_week(c) for c in classes] or [DAYS_PER_WEEK])

        class_timetables: Dict[str, List[List[Any]]] = {}
        for cls in classes:
            class_id = cls["_id"]
            days = _class_days_per_week(cls)
            table = []
            for _day in range(days):
                row = []
                for hour in range(HOURS_PER_DAY):
                    row.append(BREAK if hour in break_hours_set else EMPTY)
                table.append(row)
            class_timetables[class_id] = table

        faculty_timetables: Dict[str, List[List[Any]]] = {}
        for faculty in faculties:
            fid = faculty["_id"]
            table = []
            for _day in range(max_days):
                row = []
                for hour in range(HOURS_PER_DAY):
                    row.append(BREAK if hour in break_hours_set else EMPTY)
                table.append(row)
            faculty_timetables[fid] = table

        remaining_hours = {
            class_id: {
                subject_id: int(hours or 0)
                for subject_id, hours in subject_map.items()
            }
            for class_id, subject_map in required_hours_by_class_subject.items()
        }
        occupied_class_slots: set[Tuple[str, int, int]] = set()
        occupied_teacher_slots: set[Tuple[str, int, int]] = set()
        placed_combo_starts = 0

        for combo in sorted_combos:
            combo_id = combo["_id"]
            class_ids = [cid for cid in (combo.get("class_ids") or []) if cid in class_by_id]
            if not class_ids:
                continue
            subj_ref = combo.get("subject")
            subj = (subj_ref if isinstance(subj_ref, dict) else None) or subject_by_id.get(combo.get("subject_id"))
            if not subj:
                continue
            block = lab_block_size if _is_lab_subject(subj) else theory_block_size
            candidate_starts = combo_candidate_starts.get(combo_id, [])
            if not candidate_starts:
                continue
            ordered_starts = sorted(
                candidate_starts,
                key=lambda slot: (
                    -int((combo_id, slot[0], slot[1]) in fixed_slot_keys),
                    -sum(
                        class_slot_pressure.get((class_id, slot[0], h), 0)
                        for h in range(slot[1], slot[1] + block)
                        for class_id in class_ids
                    ),
                    -sum(
                        teacher_slot_pressure.get((fid, slot[0], h), 0)
                        for h in range(slot[1], slot[1] + block)
                        for fid in combo.get("faculty_ids", [])
                    ),
                    slot[0],
                    hour_rank.get(slot[1], slot[1]),
                ),
            )

            while min(
                remaining_hours.get(class_id, {}).get(combo["subject_id"], 0)
                for class_id in class_ids
            ) >= block:
                placed = False
                for day, hour in ordered_starts:
                    slot_hours = list(range(hour, hour + block))
                    if any(
                        (class_id, day, h) in occupied_class_slots
                        for class_id in class_ids
                        for h in slot_hours
                    ):
                        continue
                    if any(
                        (str(fid), day, h) in occupied_teacher_slots
                        for fid in combo.get("faculty_ids", [])
                        for h in slot_hours
                    ):
                        continue
                    if any(
                        day >= _class_days_per_week(class_by_id[class_id])
                        for class_id in class_ids
                    ):
                        continue

                    for h in slot_hours:
                        for class_id in class_ids:
                            class_timetables[class_id][day][h] = combo_id
                            occupied_class_slots.add((class_id, day, h))
                        for fid in combo.get("faculty_ids", []):
                            if day < len(faculty_timetables.get(str(fid), [])):
                                faculty_timetables[str(fid)][day][h] = combo_id
                            occupied_teacher_slots.add((str(fid), day, h))
                    for class_id in class_ids:
                        remaining_hours[class_id][combo["subject_id"]] -= block
                    placed_combo_starts += 1
                    placed = True
                    break
                if not placed:
                    break

        placed_class_slots = sum(
            1
            for rows in class_timetables.values()
            for row in rows
            for slot in row
            if slot not in (EMPTY, BREAK, None)
        )
        total_required = sum(
            max(0, int(hours or 0))
            for subject_map in required_hours_by_class_subject.values()
            for hours in subject_map.values()
        )
        remaining_required = sum(
            max(0, int(hours or 0))
            for subject_map in remaining_hours.values()
            for hours in subject_map.values()
        )

        return {
            "class_timetables": class_timetables,
            "faculty_timetables": faculty_timetables,
            "preview_stats": {
                "placedComboStarts": placed_combo_starts,
                "placedClassSlots": placed_class_slots,
                "scheduledHours": total_required - remaining_required,
                "remainingHours": remaining_required,
            },
        }

    for cls in classes:
        class_id = cls["_id"]
        for subj in subjects:
            subj_id = subj["_id"]
            req = required_hours_by_class_subject[class_id][subj_id]
            pairs = x_by_class_subject.get((class_id, subj_id), [])
            block = lab_block_size if _is_lab_subject(subj) else theory_block_size
            terms = [var * b for (var, b) in pairs]
            if debug_labs and req > 0 and str(subj.get("type") or "").lower() == "lab":
                logger.debug(
                    "[solve_instance] class subject coverage %s",
                    {
                        "classId": class_id,
                        "className": cls.get("name") or class_id,
                        "subjectId": subj_id,
                        "subjectName": subj.get("name") or subj_id,
                        "requiredHours": req,
                        "candidateCount": len(pairs),
                        "block": lab_block_size,
                    },
                )

            if req <= 0:
                if terms:
                    model.Add(sum(terms) == 0)
                continue
            scheduled_terms = sum(terms) if terms else 0
            if _is_lab_subject(subj):
                # For labs, use high-penalty soft constraints instead of hard equality.
                # This ensures the solver *tries* its best to place them without failing the whole model.
                
                # Minimum: aim for at least (req - 1) or floor to block size
                min_lab_hours = (req // block) * block
                if min_lab_hours < req and req > 0:
                    # If it's something like 3 hours with 2-hour blocks, 
                    # we still want to allow 2 hours as a fallback, but aim for 4.
                    pass 

                # Hard lower bound to ensure *some* placement if possible.
                # This prevents the solver from choosing an empty timetable to avoid soft penalties.
                if req >= block:
                    model.Add(scheduled_terms >= block)
                elif req > 0:
                    model.Add(scheduled_terms >= 1)
                
                # Penalty for shortage (Extremely high)
                lab_shortage = model.NewIntVar(0, req, f"lab_shortage_{class_id}_{subj_id}")
                model.Add(lab_shortage >= req - scheduled_terms)
                objective_terms.append(lab_shortage * 100000)
                
                # Penalty for overage (High, but lower than shortage)
                lab_overage = model.NewIntVar(0, block, f"lab_overage_{class_id}_{subj_id}")
                model.Add(lab_overage >= scheduled_terms - req)
                objective_terms.append(lab_overage * 5000)
                
            elif weekly_hours_hard:
                model.Add(scheduled_terms == req)
            else:
                scheduled = model.NewIntVar(0, req, f"scheduled_{class_id}_{subj_id}")
                model.Add(scheduled == scheduled_terms)
                shortage = model.NewIntVar(0, req, f"shortage_{class_id}_{subj_id}")
                model.Add(scheduled + shortage == req)
                # Strongly prioritize meeting lab hours; otherwise the solver can prefer
                # an empty timetable (especially in minimal instances) because many soft
                # constraints penalize placing sessions.
                effective_shortage_weight = weekly_hours_shortage_weight
                if _is_lab_subject(subj):
                    # Ensure lab shortages are never treated as "free" even if config weight is 0.
                    effective_shortage_weight = max(effective_shortage_weight, weekly_hours_shortage_weight * 50, 50000)

                if effective_shortage_weight > 0:
                    objective_terms.append(shortage * effective_shortage_weight)

    # Soft constraint: teacher continuity.
    teacher_continuity_teachers = [
        fid for fid in faculty_ids
        if (teacher_cont_enabled and teacher_cont_weight > 0)
        or teacher_preferences.get(fid, {}).get("maxConsecutive")
    ]
    if teacher_continuity_teachers:
        for fid in teacher_continuity_teachers:
            pref_max_consecutive = teacher_preferences.get(fid, {}).get("maxConsecutive")
            max_consecutive = (
                int(pref_max_consecutive)
                if pref_max_consecutive is not None
                else teacher_cont_max
            )
            weight = (
                teacher_pref_max_consecutive_weight
                if pref_max_consecutive is not None
                else teacher_cont_weight
            )
            if max_consecutive <= 0 or weight <= 0:
                continue
            win_len = max_consecutive + 1
            for day in range(DAYS_PER_WEEK):
                for start in range(HOURS_PER_DAY - win_len + 1):
                    if any(h in break_hours_set for h in range(start, start + win_len)):
                        continue
                    win = sum(
                        teacher_occ[(fid, day, h)] for h in range(start, start + win_len)
                    )
                    excess = model.NewIntVar(
                        0, win_len, f"teacher_cont_excess_{fid}_{day}_{start}"
                    )
                    model.Add(excess >= win - max_consecutive)
                    objective_terms.append(excess * weight)

    # Soft constraint: class continuity.
    if class_cont_enabled and class_cont_weight > 0:
        win_len = class_cont_max + 1
        for cls in classes:
            class_id = cls["_id"]
            days = _class_days_per_week(cls)
            for day in range(days):
                for start in range(HOURS_PER_DAY - win_len + 1):
                    if any(h in break_hours_set for h in range(start, start + win_len)):
                        continue
                    win = sum(
                        class_occ[(class_id, day, h)] for h in range(start, start + win_len)
                    )
                    excess = model.NewIntVar(
                        0, win_len, f"class_cont_excess_{class_id}_{day}_{start}"
                    )
                    model.Add(excess >= win - class_cont_max)
                    objective_terms.append(excess * class_cont_weight)

    # Hard constraint: no in-between class gaps within a day.
    # A gap is an empty non-break slot that has at least one class before it
    # and at least one class after it on the same day.
    for cls in classes:
        class_id = cls["_id"]
        days = _class_days_per_week(cls)
        for day in range(days):
            day_hours = [h for h in range(HOURS_PER_DAY) if h not in break_hours_set]
            if len(day_hours) <= 2:
                continue

            prefix_occ: List[cp_model.IntVar] = []
            for i, hour in enumerate(day_hours):
                occ = class_occ[(class_id, day, hour)]
                seen = model.NewBoolVar(f"class_prefix_occ_{class_id}_{day}_{hour}")
                if i == 0:
                    model.Add(seen == occ)
                else:
                    model.AddMaxEquality(seen, [prefix_occ[i - 1], occ])
                prefix_occ.append(seen)

            suffix_occ: List[cp_model.IntVar] = [None] * len(day_hours)  # type: ignore
            for i in range(len(day_hours) - 1, -1, -1):
                hour = day_hours[i]
                occ = class_occ[(class_id, day, hour)]
                seen = model.NewBoolVar(f"class_suffix_occ_{class_id}_{day}_{hour}")
                if i == len(day_hours) - 1:
                    model.Add(seen == occ)
                else:
                    model.AddMaxEquality(seen, [suffix_occ[i + 1], occ])
                suffix_occ[i] = seen

            for i in range(1, len(day_hours) - 1):
                hour = day_hours[i]
                has_before = prefix_occ[i - 1]
                has_after = suffix_occ[i + 1]
                gap = model.NewBoolVar(f"class_gap_{class_id}_{day}_{hour}")
                occ = class_occ[(class_id, day, hour)]
                model.Add(gap <= has_before)
                model.Add(gap <= has_after)
                model.Add(gap <= 1 - occ)
                model.Add(gap >= has_before + has_after - occ - 1)
                if no_gaps_hard:
                    model.Add(gap == 0)
                elif no_gaps_weight > 0:
                    objective_terms.append(gap * no_gaps_weight)

    # Fixed slots
    for fs in valid_fixed_slots:
        class_id = str(fs.get("class"))
        day = int(fs.get("day"))
        hour = int(fs.get("hour"))
        combo_id = str(fs.get("combo"))
        var = x.get((combo_id, day, hour))
        if var is None:
            fixed_slot_warnings.append(
                f"Fixed slot invalid for class {class_id} combo {combo_id} at {day},{hour}"
            )
            continue
        model.Add(var == 1)

    # Soft cap: teacher daily load.
    if teacher_daily_enabled and teacher_daily_weight > 0:
        teacher_day_load: Dict[Tuple[str, int], cp_model.IntVar] = {}
        for fid in faculty_ids:
            for day in range(DAYS_PER_WEEK):
                day_terms = [
                    teacher_occ[(fid, day, h)]
                    for h in range(HOURS_PER_DAY)
                    if h not in break_hours_set
                ]
                if not day_terms:
                    continue
                load = model.NewIntVar(0, len(day_terms), f"teacher_load_{fid}_{day}")
                model.Add(load == sum(day_terms))
                teacher_day_load[(fid, day)] = load
                overload = model.NewIntVar(
                    0, HOURS_PER_DAY, f"teacher_overload_{fid}_{day}"
                )
                model.Add(overload >= load - teacher_daily_max)
                objective_terms.append(overload * teacher_daily_weight)

    # Teacher recovery break between classes in a day.
    # Example: minHours=1 disallows immediate back-to-back slots for a teacher.
    if teacher_recovery_enabled and teacher_recovery_min_hours > 0:
        valid_hours = [h for h in range(HOURS_PER_DAY) if h not in break_hours_set]
        for fid in faculty_ids:
            for day in range(DAYS_PER_WEEK):
                for i, h1 in enumerate(valid_hours):
                    for h2 in valid_hours[i + 1 :]:
                        gap_slots = h2 - h1 - 1
                        if gap_slots >= teacher_recovery_min_hours:
                            break
                        left = teacher_occ[(fid, day, h1)]
                        right = teacher_occ[(fid, day, h2)]
                        if teacher_recovery_hard:
                            model.Add(left + right <= 1)
                        elif teacher_recovery_weight > 0:
                            violation = model.NewBoolVar(
                                f"teacher_recovery_violation_{fid}_{day}_{h1}_{h2}"
                            )
                            model.Add(violation >= left + right - 1)
                            model.Add(violation <= left)
                            model.Add(violation <= right)
                            objective_terms.append(violation * teacher_recovery_weight)

    # Class daily minimum load.
    if class_daily_min_enabled and class_daily_min_value > 0:
        for cls in classes:
            class_id = cls["_id"]
            days = _class_days_per_week(cls)
            for day in range(days):
                day_terms = [
                    class_occ[(class_id, day, h)]
                    for h in range(HOURS_PER_DAY)
                    if h not in break_hours_set
                ]
                if not day_terms:
                    continue
                day_load = model.NewIntVar(
                    0, len(day_terms), f"class_day_load_{class_id}_{day}"
                )
                model.Add(day_load == sum(day_terms))
                if class_daily_min_hard:
                    model.Add(day_load >= class_daily_min_value)
                elif class_daily_min_weight > 0:
                    shortage = model.NewIntVar(
                        0, class_daily_min_value, f"class_day_shortage_{class_id}_{day}"
                    )
                    model.Add(shortage >= class_daily_min_value - day_load)
                    objective_terms.append(shortage * class_daily_min_weight)

    # Teacher weekly load balancing: configurable min/target/max controls.
    if teacher_weekly_enabled:
        weekly_hours = [h for h in range(HOURS_PER_DAY) if h not in break_hours_set]
        weekly_capacity = DAYS_PER_WEEK * len(weekly_hours)
        for fid in faculty_ids:
            weekly_terms = [
                teacher_occ[(fid, day, hour)]
                for day in range(DAYS_PER_WEEK)
                for hour in weekly_hours
            ]
            if not weekly_terms:
                continue

            weekly_load = model.NewIntVar(0, weekly_capacity, f"teacher_week_load_{fid}")
            model.Add(weekly_load == sum(weekly_terms))

            if teacher_weekly_hard_min:
                model.Add(weekly_load >= teacher_weekly_min)
            elif teacher_weekly_under_weight > 0 and teacher_weekly_min > 0:
                under_min = model.NewIntVar(0, teacher_weekly_min, f"teacher_under_min_{fid}")
                model.Add(under_min >= teacher_weekly_min - weekly_load)
                objective_terms.append(under_min * teacher_weekly_under_weight)

            if teacher_weekly_hard_max:
                model.Add(weekly_load <= teacher_weekly_max)
            elif teacher_weekly_over_weight > 0:
                over_max = model.NewIntVar(0, weekly_capacity, f"teacher_over_max_{fid}")
                model.Add(over_max >= weekly_load - teacher_weekly_max)
                objective_terms.append(over_max * teacher_weekly_over_weight)

            if teacher_weekly_target > 0:
                if teacher_weekly_under_weight > 0:
                    under_target = model.NewIntVar(
                        0, teacher_weekly_target, f"teacher_under_target_{fid}"
                    )
                    model.Add(under_target >= teacher_weekly_target - weekly_load)
                    objective_terms.append(under_target * teacher_weekly_under_weight)
                if teacher_weekly_over_weight > 0:
                    over_target = model.NewIntVar(
                        0, weekly_capacity, f"teacher_over_target_{fid}"
                    )
                    model.Add(over_target >= weekly_load - teacher_weekly_target)
                    objective_terms.append(over_target * teacher_weekly_over_weight)

    # Avoid first/last period assignment for teachers.
    if teacher_boundary_enabled and teacher_boundary_weight > 0:
        valid_hours = [h for h in range(HOURS_PER_DAY) if h not in break_hours_set]
        if valid_hours:
            first_hour = valid_hours[0]
            last_hour = valid_hours[-1]
            for fid in faculty_ids:
                override = (
                    teacher_boundary_overrides.get(fid)
                    if isinstance(teacher_boundary_overrides.get(fid), dict)
                    else {}
                )
                avoid_first = _to_bool(override.get("avoidFirstPeriod"), teacher_boundary_avoid_first)
                avoid_last = _to_bool(override.get("avoidLastPeriod"), teacher_boundary_avoid_last)
                for day in range(DAYS_PER_WEEK):
                    if avoid_first:
                        objective_terms.append(
                            teacher_occ[(fid, day, first_hour)] * teacher_boundary_weight
                        )
                    if avoid_last and last_hour != first_hour:
                        objective_terms.append(
                            teacher_occ[(fid, day, last_hour)] * teacher_boundary_weight
                        )

    if valid_hours:
        first_hour = valid_hours[0]
        last_hour = valid_hours[-1]
        for fid, prefs in teacher_preferences.items():
            if fid not in faculty_ids:
                continue
            avoid_first = bool(prefs.get("avoidFirstPeriod"))
            avoid_last = bool(prefs.get("avoidLastPeriod"))
            preferred_days = set(prefs.get("preferredDays") or [])

            for day in range(DAYS_PER_WEEK):
                if avoid_first:
                    objective_terms.append(
                        teacher_occ[(fid, day, first_hour)] * teacher_pref_avoid_first_weight
                    )
                if avoid_last and last_hour != first_hour:
                    objective_terms.append(
                        teacher_occ[(fid, day, last_hour)] * teacher_pref_avoid_last_weight
                    )
                if preferred_days and day not in preferred_days:
                    for hour in valid_hours:
                        objective_terms.append(
                            teacher_occ[(fid, day, hour)] * teacher_pref_non_preferred_day_weight
                        )

    # Soft objective: reduce subject clustering within a day.
    if subject_cluster_enabled and subject_cluster_weight > 0:
        for cls in classes:
            class_id = cls["_id"]
            days = _class_days_per_week(cls)
            for subj in subjects:
                subj_id = subj["_id"]
                req = required_hours_by_class_subject[class_id][subj_id]
                if req <= 0:
                    continue
                for day in range(days):
                    day_terms: List[cp_model.IntVar] = []
                    for hour in range(HOURS_PER_DAY):
                        if hour in break_hours_set:
                            continue
                        day_terms += subject_covers.get((class_id, day, hour, subj_id), [])
                    if not day_terms:
                        continue
                    day_count = model.NewIntVar(
                        0, HOURS_PER_DAY, f"subj_day_count_{class_id}_{subj_id}_{day}"
                    )
                    model.Add(day_count == sum(day_terms))
                    excess = model.NewIntVar(
                        0, HOURS_PER_DAY, f"subj_day_excess_{class_id}_{subj_id}_{day}"
                    )
                    model.Add(excess >= day_count - subject_cluster_max)
                    objective_terms.append(excess * subject_cluster_weight)

    # Spread/compact subject across week by controlling active teaching days.
    if subject_distribution_enabled and subject_distribution_weight > 0:
        usable_hours_per_day = len([h for h in range(HOURS_PER_DAY) if h not in break_hours_set])
        for cls in classes:
            class_id = cls["_id"]
            days = _class_days_per_week(cls)
            if days <= 0:
                continue
            for subj in subjects:
                subj_id = subj["_id"]
                req = required_hours_by_class_subject[class_id][subj_id]
                if req <= 0:
                    continue

                day_presence_vars: List[cp_model.IntVar] = []
                for day in range(days):
                    day_terms: List[cp_model.IntVar] = []
                    for hour in range(HOURS_PER_DAY):
                        if hour in break_hours_set:
                            continue
                        day_terms += subject_covers.get((class_id, day, hour, subj_id), [])
                    if not day_terms:
                        continue
                    has_subject = model.NewBoolVar(f"subj_day_has_{class_id}_{subj_id}_{day}")
                    model.AddMaxEquality(has_subject, day_terms)
                    day_presence_vars.append(has_subject)

                if not day_presence_vars:
                    continue

                active_days = model.NewIntVar(
                    0, len(day_presence_vars), f"subj_active_days_{class_id}_{subj_id}"
                )
                model.Add(active_days == sum(day_presence_vars))

                if subject_distribution_mode == "compact":
                    min_days = max(
                        1,
                        (req + max(1, usable_hours_per_day) - 1) // max(1, usable_hours_per_day),
                    )
                    excess_days = model.NewIntVar(
                        0, len(day_presence_vars), f"subj_compact_excess_{class_id}_{subj_id}"
                    )
                    model.Add(excess_days >= active_days - min_days)
                    objective_terms.append(excess_days * subject_distribution_weight)
                else:
                    target_days = min(req, len(day_presence_vars))
                    spread_shortage = model.NewIntVar(
                        0, target_days, f"subj_spread_shortage_{class_id}_{subj_id}"
                    )
                    model.Add(spread_shortage >= target_days - active_days)
                    objective_terms.append(spread_shortage * subject_distribution_weight)

    # High-hour subjects preference for early/late periods in a day.
    if high_load_timing_enabled and high_load_timing_weight > 0:
        for cls in classes:
            class_id = cls["_id"]
            days = _class_days_per_week(cls)
            for subj in subjects:
                subj_id = subj["_id"]
                req = required_hours_by_class_subject[class_id][subj_id]
                if req < high_load_timing_min_hours:
                    continue
                demand_factor = max(1, req - high_load_timing_min_hours + 1)
                for day in range(days):
                    for hour in valid_hours:
                        terms = subject_covers.get((class_id, day, hour, subj_id), [])
                        if not terms:
                            continue
                        rank = hour_rank.get(hour, 0)
                        if high_load_timing_mode == "late":
                            slot_cost = valid_hour_count - rank
                        else:
                            slot_cost = rank + 1
                        objective_terms.append(
                            sum(terms) * high_load_timing_weight * slot_cost * demand_factor
                        )

    # Soft constraint: daily compactness per class.
    # Keep each day's occupied block as far left as possible after the hard no-gap rule.
    if daily_compactness_enabled and daily_compactness_weight > 0:
        for cls in classes:
            class_id = cls["_id"]
            days = _class_days_per_week(cls)
            if days <= 0:
                continue

            for day in range(days):
                day_occ: List[cp_model.IntVar] = [
                    class_occ[(class_id, day, hour)] for hour in valid_hours
                ]
                if len(day_occ) <= 1:
                    continue

                for i in range(len(day_occ) - 1):
                    prev_occ = day_occ[i]
                    next_occ = day_occ[i + 1]
                    violation = model.NewBoolVar(
                        f"class_daily_compact_violation_{class_id}_{day}_{i}"
                    )
                    # violation = 1 iff (prev_occ=0 and next_occ=1)
                    model.Add(violation >= next_occ - prev_occ)
                    model.Add(violation <= next_occ)
                    model.Add(violation <= 1 - prev_occ)
                    objective_terms.append(violation * daily_compactness_transition_weight)

                suffix_has_occ: List[cp_model.IntVar] = [None] * len(day_occ)  # type: ignore
                for i in range(len(day_occ) - 1, -1, -1):
                    s = model.NewBoolVar(f"class_day_suffix_has_occ_{class_id}_{day}_{i}")
                    suffix_has_occ[i] = s
                    if i == len(day_occ) - 1:
                        model.Add(s == day_occ[i])
                    else:
                        model.Add(s >= day_occ[i])
                        model.Add(s >= suffix_has_occ[i + 1])
                        model.Add(s <= day_occ[i] + suffix_has_occ[i + 1])

                for i, occ in enumerate(day_occ):
                    objective_terms.append(occ * daily_compactness_late_slot_weight * (i + 1))
                    if i == len(day_occ) - 1:
                        continue
                    empty_before_later_occ = model.NewBoolVar(
                        f"class_day_empty_before_late_occ_{class_id}_{day}_{i}"
                    )
                    # 1 iff day_occ[i] == 0 and some later slot on the same day is occupied.
                    model.Add(empty_before_later_occ <= 1 - occ)
                    model.Add(empty_before_later_occ <= suffix_has_occ[i + 1])
                    model.Add(empty_before_later_occ >= suffix_has_occ[i + 1] - occ)
                    objective_terms.append(
                        empty_before_later_occ * daily_compactness_empty_before_later_weight
                    )

    # Soft constraint: week-wide front loading per class.
    # Flatten class occupancy by (day, hour) order (excluding breaks).
    if weekly_front_loading_enabled and weekly_front_loading_weight > 0:
        for cls in classes:
            class_id = cls["_id"]
            days = _class_days_per_week(cls)
            if days <= 0:
                continue

            flat_occ: List[cp_model.IntVar] = []
            for day in range(days):
                for hour in range(HOURS_PER_DAY):
                    if hour in break_hours_set:
                        continue
                    flat_occ.append(class_occ[(class_id, day, hour)])

            if len(flat_occ) <= 1:
                continue

            for i in range(len(flat_occ) - 1):
                prev_occ = flat_occ[i]
                next_occ = flat_occ[i + 1]
                violation = model.NewBoolVar(f"class_week_frontload_violation_{class_id}_{i}")
                model.Add(violation >= next_occ - prev_occ)
                model.Add(violation <= next_occ)
                model.Add(violation <= 1 - prev_occ)
                objective_terms.append(violation * weekly_front_loading_transition_weight)

            suffix_has_occ: List[cp_model.IntVar] = [None] * len(flat_occ)  # type: ignore
            for i in range(len(flat_occ) - 1, -1, -1):
                s = model.NewBoolVar(f"class_week_suffix_has_occ_{class_id}_{i}")
                suffix_has_occ[i] = s
                if i == len(flat_occ) - 1:
                    model.Add(s == flat_occ[i])
                else:
                    model.Add(s >= flat_occ[i])
                    model.Add(s >= suffix_has_occ[i + 1])
                    model.Add(s <= flat_occ[i] + suffix_has_occ[i + 1])

            for i in range(len(flat_occ) - 1):
                empty_before_later_occ = model.NewBoolVar(
                    f"class_week_empty_before_late_occ_{class_id}_{i}"
                )
                model.Add(empty_before_later_occ <= 1 - flat_occ[i])
                model.Add(empty_before_later_occ <= suffix_has_occ[i + 1])
                model.Add(empty_before_later_occ >= suffix_has_occ[i + 1] - flat_occ[i])
                objective_terms.append(
                    empty_before_later_occ * weekly_front_loading_empty_before_later_weight
                )

            for i, occ in enumerate(flat_occ):
                objective_terms.append(occ * weekly_front_loading_late_slot_weight * (i + 1))

    # Soft constraint: balance each class's weekly load across days.
    if weekly_balance_enabled and weekly_balance_weight > 0:
        for cls in classes:
            class_id = cls["_id"]
            days = _class_days_per_week(cls)
            total_required = required_total_hours_by_class.get(class_id, 0)
            if days <= 0 or total_required <= 0:
                continue

            for day in range(days):
                daily_load = model.NewIntVar(
                    0,
                    len(valid_hours),
                    f"class_weekly_balance_load_{class_id}_{day}",
                )
                model.Add(daily_load == sum(class_occ[(class_id, day, hour)] for hour in valid_hours))
                imbalance_cap = max(total_required, len(valid_hours) * max(1, days))
                deviation = model.NewIntVar(
                    0,
                    imbalance_cap,
                    f"class_weekly_balance_dev_{class_id}_{day}",
                )
                model.Add(deviation >= daily_load * days - total_required)
                model.Add(deviation >= total_required - daily_load * days)
                objective_terms.append(deviation * weekly_balance_weight)

    if objective_terms:
        model.Minimize(sum(objective_terms))
    if search_ordered_vars:
        model.AddDecisionStrategy(
            search_ordered_vars,
            cp_model.CHOOSE_FIRST,
            cp_model.SELECT_MAX_VALUE,
        )

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = solver_time_limit_sec
    solver.parameters.num_search_workers = max(1, int(os.getenv("SOLVER_WORKERS", "8")))
    solver.parameters.random_seed = random_seed
    solver.parameters.randomize_search = True
    solver.parameters.search_branching = cp_model.PORTFOLIO_SEARCH
    solver.parameters.log_search_progress = False

    progress_callback = _SolveProgressCallback()
    early_abort_deadline_sec = min(
        solver_time_limit_sec,
        max(no_solution_abort_min_sec, solver_time_limit_sec * no_solution_abort_ratio),
    )
    early_abort_state = {"triggered": False}
    early_abort_stop = threading.Event()
    early_abort_thread = None

    if early_abort_no_solution_enabled and early_abort_deadline_sec < solver_time_limit_sec:
        def stop_if_stuck() -> None:
            if early_abort_stop.wait(early_abort_deadline_sec):
                return
            if not progress_callback.solution_found:
                early_abort_state["triggered"] = True
                _stop_search(solver)

        early_abort_thread = threading.Thread(target=stop_if_stuck, daemon=True)
        early_abort_thread.start()

    try:
        status = _solve_with_solution_callback(solver, model, progress_callback)
    finally:
        early_abort_stop.set()
        if early_abort_thread is not None:
            early_abort_thread.join(timeout=0.2)

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE) and not progress_callback.solution_found:
        failure_diagnostics = _build_failure_diagnostics()
        partial_preview = _build_partial_preview()
        solver_stats = {
            "candidate_start_count": len(x),
            "combo_count": len(combos),
            "active_combo_count": len(combo_candidate_starts),
            "constraint_count": len(model.Proto().constraints),
            "wall_time_seconds": float(solver.WallTime()),
            "status": solver.StatusName(status),
            "solutions_found": progress_callback.solution_count,
            "first_solution_wall_time_seconds": progress_callback.first_solution_wall_time_seconds,
            "early_abort_deadline_seconds": (
                float(early_abort_deadline_sec)
                if early_abort_no_solution_enabled and early_abort_deadline_sec < solver_time_limit_sec
                else None
            ),
            "early_abort_triggered": bool(early_abort_state["triggered"]),
        }
        if early_abort_state["triggered"] and not progress_callback.solution_found:
            return {
                "ok": False,
                "error": "No valid timetable found within the early-abort window",
                "reason": "early_abort_no_solution",
                "hint": "Try increasing solver time or reducing constraints.",
                "classes": classes,
                "class_timetables": partial_preview.get("class_timetables"),
                "faculty_timetables": partial_preview.get("faculty_timetables"),
                "unmet_requirements": unmet_requirements,
                "warnings": fixed_slot_warnings,
                "config": applied_config,
                "solver_stats": solver_stats,
                "diagnostics": failure_diagnostics,
                "preview_stats": partial_preview.get("preview_stats"),
            }
        return {
            "ok": False,
            "error": f"No valid timetable found within time limit ({solver.StatusName(status)})",
            "hint": "Try increasing solver time or reducing constraints.",
            "classes": classes,
            "class_timetables": partial_preview.get("class_timetables"),
            "faculty_timetables": partial_preview.get("faculty_timetables"),
            "unmet_requirements": unmet_requirements,
            "warnings": fixed_slot_warnings,
            "config": applied_config,
            "solver_stats": solver_stats,
            "diagnostics": failure_diagnostics,
            "preview_stats": partial_preview.get("preview_stats"),
        }

    # Build outputs
    max_days = max([_class_days_per_week(c) for c in classes] or [DAYS_PER_WEEK])

    class_timetables: Dict[str, List[List[Any]]] = {}
    for cls in classes:
        class_id = cls["_id"]
        days = _class_days_per_week(cls)
        table = []
        for d in range(days):
            row = []
            for h in range(HOURS_PER_DAY):
                if h in break_hours_set:
                    row.append(BREAK)
                else:
                    row.append(EMPTY)
            table.append(row)
        class_timetables[class_id] = table

    faculty_timetables: Dict[str, List[List[Any]]] = {}
    for f in faculties:
        fid = f["_id"]
        table = []
        for d in range(max_days):
            row = []
            for h in range(HOURS_PER_DAY):
                if h in break_hours_set:
                    row.append(BREAK)
                else:
                    row.append(EMPTY)
            table.append(row)
        faculty_timetables[fid] = table

    for (combo_id, day, hour), var in x.items():
        if solver.Value(var) != 1:
            continue
        combo = combo_by_id[combo_id]
        subj_ref = combo.get("subject")
        subj = (subj_ref if isinstance(subj_ref, dict) else None) or subject_by_id.get(combo.get("subject_id"))
        block = lab_block_size if _is_lab_subject(subj) else theory_block_size
        for h in range(hour, hour + block):
            for class_id in combo.get("class_ids", []):
                class_timetables[class_id][day][h] = combo_id
            for fid in combo.get("faculty_ids", []):
                faculty_timetables[fid][day][h] = combo_id

    # Post-solve unmet requirements report for transparency
    for cls in classes:
        class_id = cls["_id"]
        days = _class_days_per_week(cls)
        for subj in subjects:
            subj_id = subj["_id"]
            req = required_hours_by_class_subject[class_id][subj_id]
            if req <= 0:
                continue
            scheduled = 0
            for d in range(days):
                for h in range(HOURS_PER_DAY):
                    if h in break_hours_set:
                        continue
                    slot = class_timetables[class_id][d][h]
                    if slot == EMPTY or slot == BREAK:
                        continue
                    combo = combo_by_id.get(str(slot))
                    if combo and combo.get("subject_id") == subj_id:
                        scheduled += 1
            if scheduled < req and not any(
                u["class_id"] == class_id and u["subject_id"] == subj_id
                for u in unmet_requirements
            ):
                eligible_pairs = x_by_class_subject.get((class_id, subj_id), [])
                reason = (
                    "no_eligible_combo_starts"
                    if not eligible_pairs
                    else "infeasible_under_current_constraints"
                )
                unmet_requirements.append(
                    {
                        "class_id": class_id,
                        "subject_id": subj_id,
                        "required_hours": req,
                        "scheduled_hours": scheduled,
                        "reason": reason,
                    }
                )

    return {
        "ok": True,
        "class_timetables": class_timetables,
        "faculty_timetables": faculty_timetables,
        "classes": classes,
        "unmet_requirements": unmet_requirements,
        "warnings": fixed_slot_warnings,
        "config": applied_config,
        "objective_value": float(solver.ObjectiveValue()) if objective_terms else 0.0,
        "solver_stats": {
            "candidate_start_count": len(x),
            "combo_count": len(combos),
            "active_combo_count": len(combo_candidate_starts),
            "constraint_count": len(model.Proto().constraints),
            "wall_time_seconds": float(solver.WallTime()),
            "status": solver.StatusName(status),
            "solutions_found": progress_callback.solution_count,
            "first_solution_wall_time_seconds": progress_callback.first_solution_wall_time_seconds,
            "early_abort_deadline_seconds": (
                float(early_abort_deadline_sec)
                if early_abort_no_solution_enabled and early_abort_deadline_sec < solver_time_limit_sec
                else None
            ),
            "early_abort_triggered": bool(early_abort_state["triggered"]),
        },
    }
