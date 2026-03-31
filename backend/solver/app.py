# backend/solver/app.py

#  cd backend\solver
#  python -m venv .venv
#  .\.venv\Scripts\Activate.ps1
#  pip install -r requirements.txt (only if not working)
#  uvicorn app:app --host 0.0.0.0 --port 8001

# FastAPI CP-SAT timetable solver service
import asyncio
import os
import sys
from typing import Dict, List, Any, Tuple
from fastapi import FastAPI, Request
from ortools.sat.python import cp_model

# Avoid noisy Proactor transport shutdown tracebacks on Windows when clients disconnect.
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

app = FastAPI()

EMPTY = -1
BREAK = "BREAK"

def _solver_loop_exception_handler(loop, context):
    exc = context.get("exception")
    if isinstance(exc, ConnectionResetError):
        # Ignore noisy Windows socket shutdown resets from disconnected clients.
        if getattr(exc, "winerror", None) == 10054:
            return
    loop.default_exception_handler(context)


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


def _cfg_get(cfg: Dict[str, Any], path: List[str], default: Any) -> Any:
    node: Any = cfg
    for key in path:
        if not isinstance(node, dict) or key not in node:
            return default
        node = node[key]
    return node


def _to_bool(value: Any, default: bool) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        v = value.strip().lower()
        if v in ("true", "1", "yes", "y", "on"):
            return True
        if v in ("false", "0", "no", "n", "off"):
            return False
    return default


def _normalize_slot_list(raw: Any) -> List[Tuple[int, int]]:
    if not isinstance(raw, list):
        return []
    out: List[Tuple[int, int]] = []
    seen = set()
    for item in raw:
        if not isinstance(item, dict):
            continue
        try:
            day = int(item.get("day"))
            hour = int(item.get("hour"))
        except Exception:
            continue
        key = (day, hour)
        if key in seen:
            continue
        seen.add(key)
        out.append(key)
    return out


def _normalize_teacher_slot_map(raw: Any) -> Dict[str, set]:
    if not isinstance(raw, dict):
        return {}
    out: Dict[str, set] = {}
    for teacher_id, slots in raw.items():
        tid = str(teacher_id)
        norm = set(_normalize_slot_list(slots))
        if norm:
            out[tid] = norm
    return out


def _normalize_teacher_preferences_map(raw: Any) -> Dict[str, Dict[str, Any]]:
    if not isinstance(raw, dict):
        return {}
    out: Dict[str, Dict[str, Any]] = {}
    for teacher_id, prefs in raw.items():
        if not isinstance(prefs, dict):
            continue
        tid = str(teacher_id)
        preferred_days_raw = prefs.get("preferredDays") or []
        preferred_days = sorted(
            {
                int(day)
                for day in preferred_days_raw
                if isinstance(day, (int, float, str)) and str(day).strip().isdigit() and int(day) >= 0
            }
        )
        max_consecutive_raw = prefs.get("maxConsecutive")
        try:
            max_consecutive = int(max_consecutive_raw) if max_consecutive_raw is not None else None
        except Exception:
            max_consecutive = None
        if max_consecutive is not None and max_consecutive <= 0:
            max_consecutive = None

        out[tid] = {
            "avoidFirstPeriod": _to_bool(prefs.get("avoidFirstPeriod"), False),
            "avoidLastPeriod": _to_bool(prefs.get("avoidLastPeriod"), False),
            "maxConsecutive": max_consecutive,
            "preferredDays": preferred_days,
        }
    return out


@app.on_event("startup")
async def _install_loop_handler():
    loop = asyncio.get_running_loop()
    loop.set_exception_handler(_solver_loop_exception_handler)


@app.get("/health")
def health() -> Dict[str, str]:
    return {"ok": "true"}


@app.post("/solve")
async def solve(request: Request) -> Dict[str, Any]:
    payload = await request.json()
    constraint_config = payload.get("constraintConfig") or {}

    faculties = [_normalize_id(f) for f in payload.get("faculties", [])]
    subjects = [_normalize_id({**s, "type": s.get("type") or "theory"}) for s in payload.get("subjects", [])]
    classes = [_normalize_id(c) for c in payload.get("classes", [])]
    combos_raw = payload.get("combos", [])

    combos = []
    for c in combos_raw:
        combo = {
            **c,
            "_id": str(c.get("_id") or c.get("id")),
            "subject_id": str(c.get("subject_id")),
            "faculty_ids": [str(x) for x in (c.get("faculty_ids") or ([c.get("faculty_id")] if c.get("faculty_id") else []))],
            "class_ids": [str(x) for x in (c.get("class_ids") or [])],
        }
        combos.append(combo)

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

    fixed_slots = payload.get("fixed_slots") or payload.get("fixedSlots") or []
    random_seed = int(payload.get("random_seed") or os.getenv("SOLVER_RANDOM_SEED", "1"))
    solver_time_limit_sec = float(
        _cfg_get(
            constraint_config,
            ["solver", "timeLimitSec"],
            payload.get("solver_time_limit_sec") or os.getenv("SOLVER_TIME_LIMIT_SEC", "180"),
        )
    )

    lab_block_size = max(1, int(_cfg_get(constraint_config, ["structural", "labBlockSize"], 2)))
    theory_block_size = max(1, int(_cfg_get(constraint_config, ["structural", "theoryBlockSize"], 1)))

    weekly_hours_hard = _to_bool(
        _cfg_get(constraint_config, ["weeklySubjectHours", "hard"], True),
        True,
    )
    weekly_hours_shortage_weight = max(
        0, int(_cfg_get(constraint_config, ["weeklySubjectHours", "shortageWeight"], 1000))
    )

    teacher_cont_enabled = _to_bool(
        _cfg_get(constraint_config, ["teacherContinuity", "enabled"], True), True
    )
    teacher_cont_max = max(
        1, int(_cfg_get(constraint_config, ["teacherContinuity", "maxConsecutive"], 3))
    )
    teacher_cont_weight = max(0, int(_cfg_get(constraint_config, ["teacherContinuity", "weight"], 100)))

    class_cont_enabled = _to_bool(
        _cfg_get(constraint_config, ["classContinuity", "enabled"], True), True
    )
    class_cont_max = max(
        1, int(_cfg_get(constraint_config, ["classContinuity", "maxConsecutive"], 3))
    )
    class_cont_weight = max(0, int(_cfg_get(constraint_config, ["classContinuity", "weight"], 80)))

    no_gaps_hard = _to_bool(_cfg_get(constraint_config, ["noGaps", "hard"], True), True)
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
        _cfg_get(constraint_config, ["subjectClustering", "enabled"], True), True
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

    front_loading_enabled = _to_bool(
        _cfg_get(constraint_config, ["frontLoading", "enabled"], True), True
    )
    front_loading_weight = max(0, int(_cfg_get(constraint_config, ["frontLoading", "weight"], 400)))
    front_loading_transition_weight = max(
        0,
        int(
            _cfg_get(
                constraint_config,
                ["frontLoading", "transitionWeight"],
                front_loading_weight,
            )
        ),
    )
    front_loading_empty_before_later_weight = max(
        0,
        int(
            _cfg_get(
                constraint_config,
                ["frontLoading", "emptyBeforeLaterOccupiedWeight"],
                front_loading_weight,
            )
        ),
    )
    front_loading_late_slot_weight = max(
        0,
        int(
            _cfg_get(
                constraint_config,
                ["frontLoading", "lateSlotWeight"],
                front_loading_weight,
            )
        ),
    )

    teacher_avail_enabled = _to_bool(
        _cfg_get(constraint_config, ["teacherAvailability", "enabled"], False), False
    )
    teacher_avail_hard = _to_bool(
        _cfg_get(constraint_config, ["teacherAvailability", "hard"], True), True
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
        "frontLoading": {
            "enabled": front_loading_enabled,
            "weight": front_loading_weight,
            "transitionWeight": front_loading_transition_weight,
            "emptyBeforeLaterOccupiedWeight": front_loading_empty_before_later_weight,
            "lateSlotWeight": front_loading_late_slot_weight,
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
        "solver": {"timeLimitSec": solver_time_limit_sec},
    }

    subject_by_id = {s["_id"]: s for s in subjects}
    class_by_id = {c["_id"]: c for c in classes}
    combo_by_id = {c["_id"]: c for c in combos}
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
        if day < 0 or day >= int(class_by_id[class_id].get("days_per_week") or DAYS_PER_WEEK):
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
            day >= int(class_by_id[cid].get("days_per_week") or DAYS_PER_WEEK)
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
                block = lab_block_size if subj and subj.get("type") == "lab" else theory_block_size
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

    for combo in combos:
        combo_id = combo["_id"]
        class_ids = [cid for cid in (combo.get("class_ids") or []) if cid in class_by_id]
        if not class_ids:
            continue
        subj = subject_by_id.get(combo["subject_id"])
        if not subj:
            continue
        if any(required_hours_by_class_subject[cid].get(combo["subject_id"], 0) <= 0 for cid in class_ids):
            continue
        block = lab_block_size if subj.get("type") == "lab" else theory_block_size
        max_days_for_combo = min(
            [int(class_by_id[cid].get("days_per_week") or DAYS_PER_WEEK) for cid in class_ids] or [DAYS_PER_WEEK]
        )
        candidate_starts: List[Tuple[int, int]] = []
        for day in range(max_days_for_combo):
            for hour in range(HOURS_PER_DAY):
                if hour in break_hours_set:
                    continue
                if hour + block > HOURS_PER_DAY:
                    continue
                if any(h in break_hours_set for h in range(hour, hour + block)):
                    continue

                violates_availability = False
                if teacher_avail_enabled:
                    for fid in combo.get("faculty_ids", []):
                        if any(_is_teacher_unavailable(fid, day, h) for h in range(hour, hour + block)):
                            violates_availability = True
                            break
                    if teacher_avail_hard and violates_availability:
                        continue
                candidate_starts.append((day, hour))

        if not candidate_starts:
            continue

        combo_candidate_starts[combo_id] = candidate_starts

        required_hours = max(
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
        combo_search_rank[combo_id] = (
            (10000 if subj.get("type") == "lab" else 0)
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
        if not class_ids or not candidate_starts:
            continue
        subj = subject_by_id.get(combo["subject_id"])
        if not subj:
            continue
        block = lab_block_size if subj.get("type") == "lab" else theory_block_size
        ordered_starts = sorted(
            candidate_starts,
            key=lambda slot: (
                -int((combo_id, slot[0], slot[1]) in fixed_slot_keys),
                slot[0],
                hour_rank.get(slot[1], slot[1]),
            ),
        )
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
        days = int(cls.get("days_per_week") or DAYS_PER_WEEK)
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
        days = int(cls.get("days_per_week") or DAYS_PER_WEEK)
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
        subj = subject_by_id.get(combo["subject_id"])
        if not subj:
            continue
        block = lab_block_size if subj.get("type") == "lab" else theory_block_size
        for class_id in combo.get("class_ids", []):
            x_by_class_subject.setdefault((class_id, combo["subject_id"]), []).append(
                (var, block)
            )

    for cls in classes:
        class_id = cls["_id"]
        for subj in subjects:
            subj_id = subj["_id"]
            req = required_hours_by_class_subject[class_id][subj_id]
            pairs = x_by_class_subject.get((class_id, subj_id), [])
            terms = [var * block for (var, block) in pairs]

            if req <= 0:
                if terms:
                    model.Add(sum(terms) == 0)
                continue
            scheduled_terms = sum(terms) if terms else 0
            if weekly_hours_hard:
                model.Add(scheduled_terms == req)
            else:
                scheduled = model.NewIntVar(0, req, f"scheduled_{class_id}_{subj_id}")
                model.Add(scheduled == scheduled_terms)
                shortage = model.NewIntVar(0, req, f"shortage_{class_id}_{subj_id}")
                model.Add(scheduled + shortage == req)
                objective_terms.append(shortage * weekly_hours_shortage_weight)

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
            days = int(cls.get("days_per_week") or DAYS_PER_WEEK)
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
        days = int(cls.get("days_per_week") or DAYS_PER_WEEK)
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
            days = int(cls.get("days_per_week") or DAYS_PER_WEEK)
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
            days = int(cls.get("days_per_week") or DAYS_PER_WEEK)
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
            days = int(cls.get("days_per_week") or DAYS_PER_WEEK)
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
            days = int(cls.get("days_per_week") or DAYS_PER_WEEK)
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

    # Medium soft constraint: global front-loading per class across the full week.
    # Flatten class occupancy by (day, hour) order (excluding breaks).
    # 1) Penalize any 0 -> 1 transition (occupied after empty).
    # 2) Penalize an empty slot if any later slot is occupied.
    # 3) Penalize occupied slots with larger position index.
    # Together this strongly pushes empty slots toward the end of the week,
    # while still respecting hard constraints and fixed slots.
    if front_loading_enabled and front_loading_weight > 0:
        for cls in classes:
            class_id = cls["_id"]
            days = int(cls.get("days_per_week") or DAYS_PER_WEEK)
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
                violation = model.NewBoolVar(f"class_frontload_violation_{class_id}_{i}")
                # violation = 1 iff (prev_occ=0 and next_occ=1)
                model.Add(violation >= next_occ - prev_occ)
                model.Add(violation <= next_occ)
                model.Add(violation <= 1 - prev_occ)
                objective_terms.append(violation * front_loading_transition_weight)

            # Stronger compaction: penalize any empty slot that has an occupied slot later.
            suffix_has_occ: List[cp_model.IntVar] = [None] * len(flat_occ)  # type: ignore
            for i in range(len(flat_occ) - 1, -1, -1):
                s = model.NewBoolVar(f"class_suffix_has_occ_{class_id}_{i}")
                suffix_has_occ[i] = s
                if i == len(flat_occ) - 1:
                    model.Add(s == flat_occ[i])
                else:
                    model.Add(s >= flat_occ[i])
                    model.Add(s >= suffix_has_occ[i + 1])
                    model.Add(s <= flat_occ[i] + suffix_has_occ[i + 1])

            for i in range(len(flat_occ) - 1):
                empty_before_later_occ = model.NewBoolVar(
                    f"class_empty_before_late_occ_{class_id}_{i}"
                )
                # 1 iff flat_occ[i] == 0 and some later slot is occupied.
                model.Add(empty_before_later_occ <= 1 - flat_occ[i])
                model.Add(empty_before_later_occ <= suffix_has_occ[i + 1])
                model.Add(empty_before_later_occ >= suffix_has_occ[i + 1] - flat_occ[i])
                objective_terms.append(
                    empty_before_later_occ * front_loading_empty_before_later_weight
                )

            # Additional compaction pressure: later occupied positions are costlier.
            # This improves week-end empty-slot packing, especially when fixed slots exist.
            for i, occ in enumerate(flat_occ):
                objective_terms.append(occ * front_loading_late_slot_weight * (i + 1))

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

    status = solver.Solve(model)

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return {
            "ok": False,
            "error": f"Solver status: {solver.StatusName(status)}",
            "classes": classes,
            "unmet_requirements": unmet_requirements,
            "warnings": fixed_slot_warnings,
            "config": applied_config,
        }

    # Build outputs
    max_days = max([int(c.get("days_per_week") or DAYS_PER_WEEK) for c in classes] or [DAYS_PER_WEEK])

    class_timetables: Dict[str, List[List[Any]]] = {}
    for cls in classes:
        class_id = cls["_id"]
        days = int(cls.get("days_per_week") or DAYS_PER_WEEK)
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
        subj = subject_by_id[combo["subject_id"]]
        block = lab_block_size if subj.get("type") == "lab" else theory_block_size
        for h in range(hour, hour + block):
            for class_id in combo.get("class_ids", []):
                class_timetables[class_id][day][h] = combo_id
            for fid in combo.get("faculty_ids", []):
                faculty_timetables[fid][day][h] = combo_id

    # Post-solve unmet requirements report for transparency
    for cls in classes:
        class_id = cls["_id"]
        days = int(cls.get("days_per_week") or DAYS_PER_WEEK)
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
                unmet_requirements.append(
                    {
                        "class_id": class_id,
                        "subject_id": subj_id,
                        "required_hours": req,
                        "scheduled_hours": scheduled,
                        "reason": "infeasible_under_current_constraints",
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
        },
    }
