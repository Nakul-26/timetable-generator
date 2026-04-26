# backend/solver/app.py

#  cd backend\solver
#  python -m venv .venv
#  .\.venv\Scripts\Activate.ps1
#  pip install -r requirements.txt (only if not working)
#  uvicorn app:app --host 0.0.0.0 --port 8001 --reload

# FastAPI CP-SAT timetable solver service
import asyncio
import copy
import hashlib
import json
import os
import urllib.request
import urllib.error
from pathlib import Path
import sys
import threading
import time
from typing import Dict, List, Any, Tuple
from fastapi import FastAPI, Request
from ortools.sat.python import cp_model
from bson import ObjectId
from pymongo import MongoClient
import boto3

DEBUG = os.getenv("DEBUG_SOLVER", "0").strip().lower() in ("1", "true", "yes", "on")

# Avoid noisy Proactor transport shutdown tracebacks on Windows when clients disconnect.
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

app = FastAPI()

EMPTY = -1
BREAK = "BREAK"


def _load_local_env() -> None:
    # Match the Node backend behavior by loading backend/.env for local runs.
    candidates = [
        Path(__file__).resolve().parent / ".env",
        Path(__file__).resolve().parent.parent / ".env",
    ]
    for env_path in candidates:
        if not env_path.is_file():
            continue
        for raw_line in env_path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            if not key or key in os.environ:
                continue
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
                value = value[1:-1]
            os.environ[key] = value
        break


_load_local_env()

def _apply_config_preset(config: Dict[str, Any], mode: str = "college") -> Dict[str, Any]:
    """Apply preset configurations based on institution type."""
    if mode == "school":
        # Strict mode for schools
        config.setdefault("noGaps", {})["hard"] = True
        config.setdefault("teacherAvailability", {})["hard"] = True
        config.setdefault("teacherContinuity", {})["weight"] = 150  # Higher
    elif mode == "college":
        # Relaxed for colleges to allow imperfect solutions
        config.setdefault("noGaps", {})["hard"] = False
        config.setdefault("teacherAvailability", {})["hard"] = False
        config.setdefault("teacherContinuity", {})["weight"] = 100
    elif mode == "coaching":
        # Relaxed for coaching centers
        config.setdefault("noGaps", {})["hard"] = False
        config.setdefault("teacherAvailability", {})["hard"] = False
        config.setdefault("teacherContinuity", {})["weight"] = 50  # Lower
    elif mode == "test":
        # Very relaxed for testing minimal cases
        config.setdefault("noGaps", {})["hard"] = False
        config.setdefault("teacherAvailability", {})["hard"] = False
        config.setdefault("weeklySubjectHours", {})["hard"] = False
        config.setdefault("teacherContinuity", {})["weight"] = 10
    return config

def analyze_difficulty(
    infeasible_attempts: int,
    attempts_run: int,
    candidates_found: int,
    elapsed_time: float,
) -> str:
    """Analyze problem difficulty based on runtime metrics."""
    if attempts_run == 0:
        return "unknown"

    infeasible_ratio = infeasible_attempts / attempts_run

    if infeasible_ratio > 0.8:  # Increased from 0.7
        return "very_hard"
    elif infeasible_ratio > 0.6:  # Increased from 0.4
        return "hard"
    elif candidates_found == 0 and elapsed_time > 30:  # Increased from 20
        return "hard"
    elif candidates_found > 0:
        return "medium"
    return "easy"

def adapt_constraints(config: Dict[str, Any], difficulty: str, iteration: int) -> Dict[str, Any]:
    """Adapt constraints based on detected difficulty."""
    cfg = copy.deepcopy(config)

    if difficulty == "very_hard":
        # Relax aggressively
        cfg.setdefault("noGaps", {})["hard"] = False
        cfg.setdefault("teacherAvailability", {})["hard"] = False

        # Reduce weights (allow flexibility) - less aggressive
        for section in cfg:
            if isinstance(cfg[section], dict):
                for k, v in cfg[section].items():
                    if "weight" in k.lower() and isinstance(v, (int, float)):
                        cfg[section][k] = int(v * 0.7)  # Increased from 0.4 to 0.7

    elif difficulty == "hard":
        cfg.setdefault("noGaps", {})["hard"] = False

        for section in cfg:
            if isinstance(cfg[section], dict):
                for k, v in cfg[section].items():
                    if "weight" in k.lower() and isinstance(v, (int, float)):
                        cfg[section][k] = int(v * 0.8)  # Increased from 0.6 to 0.8

        # Slight relaxation - less aggressive
        for section in cfg:
            if isinstance(cfg[section], dict):
                for k, v in cfg[section].items():
                    if "weight" in k.lower() and isinstance(v, (int, float)):
                        cfg[section][k] = int(v * 0.9)  # Increased from 0.8 to 0.9

    return cfg

def _solver_base_url() -> str:
    port = os.getenv("PORT", "8001")
    return f"http://127.0.0.1:{port}"


def _call_local_solve(payload: Dict[str, Any]) -> Dict[str, Any]:
    req = urllib.request.Request(
        f"{_solver_base_url()}/solve",
        data=json.dumps(payload, default=_json_default).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=max(30, int((payload.get("solver_time_limit_sec") or DEFAULT_SOLVER_TIME_LIMIT_SEC) + 30))) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="ignore")
        try:
            return json.loads(body)
        except Exception:
            return {"ok": False, "error": body or f"Solver HTTP {exc.code}"}
    except Exception as exc:
        return {"ok": False, "error": str(exc) or "Solver request failed"}

def get_adaptive_time_limit(difficulty: str, base_time: float) -> float:
    """Get adaptive time limit based on difficulty."""
    budget = max(5.0, float(base_time or 0))
    share_by_difficulty = {
        "very_hard": 0.80,
        "hard": 0.60,
        "medium": 0.45,
        "easy": 0.35,
        "unknown": 0.55,
    }
    share = share_by_difficulty.get(difficulty, 0.55)
    return max(30.0, budget * share)

DEFAULT_SOLVER_TIME_LIMIT_SEC = 180.0
DEFAULT_SOLUTION_COUNT = 2
MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB_NAME = os.getenv("MONGO_DB_NAME", "timetable_jayanth")
JOB_COLLECTION_NAME = os.getenv("GENERATION_JOB_COLLECTION", "generationjobs")
TIMETABLE_RESULT_COLLECTION_NAME = os.getenv("TIMETABLE_RESULT_COLLECTION", "timetableresults")
ACTIVE_JOB_TASKS = set()

# Polling-based job pickup (backend can just create a pending job and return).
SOLVER_PULL_INTERVAL_SEC = float(os.getenv("SOLVER_PULL_INTERVAL_SEC", "5"))
DEBUG_DUMP_PAYLOADS = os.getenv("DEBUG_DUMP_PAYLOADS", "0").strip().lower() in ("1", "true", "yes", "on")


def _json_default(value: Any) -> Any:
    """Best-effort JSON serializer for debugging/HTTP payloads."""
    if isinstance(value, ObjectId):
        return str(value)

    iso = getattr(value, "isoformat", None)
    if callable(iso):
        try:
            return iso()
        except Exception:
            pass

    if isinstance(value, (set, tuple)):
        return list(value)

    return str(value)


def _stop_ec2_instance():
    """Stop the EC2 instance to save costs after job completion."""
    try:
        instance_id = os.getenv("EC2_INSTANCE_ID")
        aws_region = os.getenv("AWS_REGION", "eu-north-1")

        if not instance_id:
            print("EC2_INSTANCE_ID not set, skipping EC2 stop")
            return

        print(f"Stopping EC2 instance {instance_id}...")

        ec2 = boto3.client('ec2', region_name=aws_region)
        ec2.stop_instances(InstanceIds=[instance_id])

        print("EC2 instance stopped successfully")

    except Exception as e:
        print(f"Failed to stop EC2 instance: {e}")


def _job_filter(job_id: str) -> Dict[str, Any]:
    try:
        return {"_id": ObjectId(job_id)}
    except Exception:
        return {"_id": job_id}


def _get_jobs_collection():
    if not MONGO_URI:
        raise RuntimeError("MONGO_URI is required for solver job processing")
    client = MongoClient(MONGO_URI)
    return client, client[MONGO_DB_NAME][JOB_COLLECTION_NAME]


def _get_timetable_results_collection():
    if not MONGO_URI:
        raise RuntimeError("MONGO_URI is required for timetable result persistence")
    client = MongoClient(MONGO_URI)
    return client, client[MONGO_DB_NAME][TIMETABLE_RESULT_COLLECTION_NAME]


async def _resume_pending_jobs():
    """Resume any jobs that were pending or running when the solver restarted."""
    try:
        client, jobs = _get_jobs_collection()
        pending_jobs = list(jobs.find({
            "status": {"$in": ["pending", "running"]}
        }))
        for job in pending_jobs:
            job_id = str(job["_id"])
            payload = job.get("payload") or (job.get("input") or {}).get("payload")
            if payload:
                print(f"Resuming job {job_id}")
                _spawn_generation_job(job_id, payload)
            else:
                print(f"Cannot resume job {job_id}: no payload found")
    except Exception as exc:
        print(f"Error resuming jobs: {exc}")


async def _poll_for_pending_jobs() -> None:
    """Continuously poll MongoDB for new pending jobs and start them.

    This avoids requiring a serverless backend (e.g., Vercel) to call the solver.
    """
    while True:
        try:
            client, jobs = _get_jobs_collection()
            try:
                pending_jobs = list(jobs.find({"status": "pending"}, {"payload": 1}).limit(10))
            finally:
                client.close()

            for job in pending_jobs:
                job_id = str(job.get("_id"))
                payload = job.get("payload") or (job.get("input") or {}).get("payload")
                if not payload:
                    print(f"Skipping pending job {job_id}: no payload")
                    continue

                # Atomically claim the job to avoid duplicate spawns.
                try:
                    client2, jobs2 = _get_jobs_collection()
                    try:
                        claimed = jobs2.update_one(
                            {"_id": job.get("_id"), "status": "pending"},
                            {"$set": {"status": "running", "phase": "start", "progress": 0}},
                        )
                    finally:
                        client2.close()

                    if getattr(claimed, "modified_count", 0) != 1:
                        continue
                except Exception as exc:
                    print(f"Failed to claim pending job {job_id}: {exc}")
                    continue

                print(f"Picked up pending job {job_id}")
                _spawn_generation_job(job_id, payload)
        except Exception as exc:
            print(f"Error polling pending jobs: {exc}")

        await asyncio.sleep(max(1.0, SOLVER_PULL_INTERVAL_SEC))


def _set_job_state(job_id: str, **fields: Any) -> None:
    client, jobs = _get_jobs_collection()
    try:
        fields["updatedAt"] = fields.get("updatedAt") or __import__("datetime").datetime.utcnow()
        jobs.update_one(_job_filter(job_id), {"$set": fields})
    finally:
        client.close()


def _is_cancel_requested(job_id: str) -> bool:
    client, jobs = _get_jobs_collection()
    try:
        doc = jobs.find_one(_job_filter(job_id), {"cancel_requested": 1})
        return bool(doc and doc.get("cancel_requested"))
    finally:
        client.close()


def _persist_completed_timetable(job_id: str, result: Dict[str, Any]) -> None:
    best_class_timetables = result.get("bestClassTimetables") or result.get("class_timetables")
    if not isinstance(best_class_timetables, dict) or not best_class_timetables:
        return

    now = __import__("datetime").datetime.utcnow()
    document = {
        "name": f"Generated Timetable - {now.strftime('%Y-%m-%d %H:%M:%S UTC')}",
        "source": "generator",
        "status": "generated",
        "source_generation_job_id": str(job_id),
        "class_timetables": best_class_timetables,
        "faculty_timetables": result.get("bestFacultyTimetables") or result.get("faculty_timetables"),
        "faculty_daily_hours": result.get("bestFacultyDailyHours") or result.get("faculty_daily_hours"),
        "score": result.get("bestScore") if result.get("bestScore") is not None else result.get("score"),
        "objective_value": (
            result.get("objectiveValue")
            if result.get("objectiveValue") is not None
            else result.get("objective_value")
        ),
        "generation_batch_id": result.get("generation_batch_id"),
        "selected_option_id": result.get("selected_option_id"),
        "generation_options": result.get("generation_options") or [],
        "combos": result.get("combos"),
        "allocations_report": result.get("allocations_report"),
        "config": result.get("config"),
        "createdAt": now,
        "updatedAt": now,
    }

    client, results = _get_timetable_results_collection()
    try:
        results.update_one(
            {"source_generation_job_id": str(job_id)},
            {"$setOnInsert": document},
            upsert=True,
        )
    finally:
        client.close()


def _analyze_class_internal_gaps(class_timetables: Dict[str, Any]) -> Dict[str, int]:
    gap_count = 0
    if not isinstance(class_timetables, dict):
        return {"gapCount": 0}

    for rows in class_timetables.values():
        if not isinstance(rows, list):
            continue
        for row in rows:
            if not isinstance(row, list):
                continue
            teaching_slots = [
                idx
                for idx, slot in enumerate(row)
                if slot not in (EMPTY, BREAK, None)
            ]
            if len(teaching_slots) <= 1:
                continue
            first = teaching_slots[0]
            last = teaching_slots[-1]
            for hour in range(first + 1, last):
                slot = row[hour]
                if slot in (EMPTY, None):
                    gap_count += 1
    return {"gapCount": gap_count}


def _stable_serialize(value: Any) -> Any:
    if isinstance(value, list):
        return [_stable_serialize(item) for item in value]
    if isinstance(value, dict):
        return {key: _stable_serialize(value[key]) for key in sorted(value.keys())}
    return value


def _hash_timetable(class_timetables: Dict[str, Any]) -> str:
    if not isinstance(class_timetables, dict):
        return ""
    stable = json.dumps(_stable_serialize(class_timetables), separators=(",", ":"), sort_keys=True)
    return hashlib.sha256(stable.encode("utf-8")).hexdigest()


def _compare_timetable_difference(left: Dict[str, Any], right: Dict[str, Any]) -> Dict[str, int]:
    class_ids = set((left or {}).keys()) | set((right or {}).keys())
    total_slots = 0
    different_slots = 0
    for class_id in class_ids:
        left_days = left.get(class_id) if isinstance(left, dict) else []
        right_days = right.get(class_id) if isinstance(right, dict) else []
        left_days = left_days if isinstance(left_days, list) else []
        right_days = right_days if isinstance(right_days, list) else []
        day_count = max(len(left_days), len(right_days))
        for day in range(day_count):
            left_row = left_days[day] if day < len(left_days) and isinstance(left_days[day], list) else []
            right_row = right_days[day] if day < len(right_days) and isinstance(right_days[day], list) else []
            hour_count = max(len(left_row), len(right_row))
            for hour in range(hour_count):
                left_value = left_row[hour] if hour < len(left_row) else None
                right_value = right_row[hour] if hour < len(right_row) else None
                total_slots += 1
                if left_value != right_value:
                    different_slots += 1
    return {"totalSlots": total_slots, "differentSlots": different_slots}


def _build_option_label(candidate: Dict[str, Any], index: int) -> str:
    if index == 0:
        return "Option 1 (Best balanced)"
    if not candidate.get("unmet_requirements") and not candidate.get("warnings"):
        return f"Option {index + 1} (Cleanest fit)"
    if (candidate.get("score") or 0) <= 0:
        return f"Option {index + 1} (Compact schedule)"
    if len(candidate.get("warnings") or []) <= 1:
        return f"Option {index + 1} (Lower friction)"
    return f"Option {index + 1} (Alternative)"


def _build_attempt_constraint_config(
    base_config: Dict[str, Any],
    strategy: Dict[str, Any],
    per_attempt_time_limit_sec: float,
    adaptive_relax: bool = False,
    difficulty: str = "unknown",
) -> Dict[str, Any]:
    config = copy.deepcopy(base_config) if isinstance(base_config, dict) else {}
    solver_cfg = config.setdefault("solver", {})
    user_max_candidates = solver_cfg.get("maxCandidatesPerCombo")
    user_early_abort = solver_cfg.get("earlyAbortNoSolution")
    user_abort_ratio = solver_cfg.get("noSolutionAbortRatio")
    user_abort_min_sec = solver_cfg.get("noSolutionAbortMinSec")
    solver_cfg["timeLimitSec"] = per_attempt_time_limit_sec
    # Adaptive search space based on difficulty
    adaptive_max_candidates = {
        "very_hard": 0,  # Unlimited
        "hard": 20,
        "medium": 15,
        "easy": 12,
        "unknown": 15,
    }.get(difficulty, 15)

    solver_cfg["maxCandidatesPerCombo"] = int(
        user_max_candidates if user_max_candidates is not None else (strategy.get("maxCandidatesPerCombo") or adaptive_max_candidates)
    )
    solver_cfg["earlyAbortNoSolution"] = (
        bool(user_early_abort)
        if user_early_abort is not None
        else bool(strategy.get("earlyAbortNoSolution", True))
    )
    solver_cfg["noSolutionAbortRatio"] = float(
        user_abort_ratio if user_abort_ratio is not None else strategy.get("noSolutionAbortRatio", 0.4)
    )
    solver_cfg["noSolutionAbortMinSec"] = float(
        user_abort_min_sec if user_abort_min_sec is not None else strategy.get("noSolutionAbortMinSec", 10)
    )

    if strategy.get("relaxSoftConstraints") or adaptive_relax:  # Temporarily disabled adaptive_relax
        for section_name, weight_scale in (
            ("teacherContinuity", 0.5),
            ("classContinuity", 0.5),
            ("teacherDailyOverload", 0.5),
            ("teacherRecoveryBreak", 0.4),
            ("subjectClustering", 0.4),
            ("subjectDistribution", 0.4),
            ("highLoadSubjectTiming", 0.3),
            ("dailyCompactness", 0.35),
            ("weeklyFrontLoading", 0.35),
            ("teacherWeeklyLoadBalance", 0.4),
            ("classDailyMinimumLoad", 0.5),
            ("teacherBoundaryPreference", 0.4),
            ("teacherAvailability", 1.0),
            ("noGaps", 1.0),
        ):
            section = config.get(section_name)
            if not isinstance(section, dict):
                continue
            for key, value in list(section.items()):
                if "weight" not in key.lower() or not isinstance(value, (int, float)):
                    continue
                section[key] = max(0, int(round(value * weight_scale)))

    return config


def _run_generation_batch(payload: Dict[str, Any], progress_callback=None, cancel_check=None) -> Dict[str, Any]:
    # DEBUG: Log payload summary at start of generation
    print("=== GENERATION PAYLOAD SUMMARY ===")
    print(f"inputMode: {payload.get('inputMode', 'EXPLICIT')}")
    print(f"classes: {len(payload.get('classes', []))}")
    print(f"subjects: {len(payload.get('subjects', []))}")
    print(f"faculties: {len(payload.get('faculties', []))}")
    print(f"combos: {len(payload.get('combos', []))}")
    print(f"fixedSlots: {len(payload.get('fixedSlots', []))}")
    print(f"DAYS_PER_WEEK: {payload.get('DAYS_PER_WEEK')}")
    print(f"HOURS_PER_DAY: {payload.get('HOURS_PER_DAY')}")
    print(f"constraintConfig keys: {list(payload.get('constraintConfig', {}).keys())}")
    if DEBUG_DUMP_PAYLOADS:
        print("Full payload saved to generation_payload.json")
    print("=== GENERATION PAYLOAD SUMMARY END ===")

    if DEBUG_DUMP_PAYLOADS:
        try:
            with open("generation_payload.json", "w", encoding="utf-8") as f:
                json.dump(payload, f, indent=2, default=_json_default)
        except Exception as exc:
            print(f"Failed to dump generation payload: {exc}")

    classes = payload.get("classes") or []
    faculties = payload.get("faculties") or []
    subjects = payload.get("subjects") or []
    combos = payload.get("combos") or []
    skip_strict = (
        len(combos) > 200 or
        len(classes) > 6 or
        len(faculties) < len(subjects)
    )  # Better heuristic
    fixed_slots = payload.get("fixedSlots") or []
    days_per_week = int(payload.get("DAYS_PER_WEEK") or 6)
    hours_per_day = int(payload.get("HOURS_PER_DAY") or 8)
    constraint_config = payload.get("constraintConfig") or {}
    mode = payload.get("mode") or "college"
    constraint_config = _apply_config_preset(constraint_config, mode)

    candidates: List[Dict[str, Any]] = []  # Initialize candidates before feasibility

    solution_count = max(
        1,
        min(
            3 if len(classes) > 5 else 5,
            int(
                payload.get("solutionCount")
                or _cfg_get(constraint_config, ["solver", "solutionCount"], DEFAULT_SOLUTION_COUNT)
            ),
        ),
    )

    def ranked_candidates() -> List[Dict[str, Any]]:
        return sorted(
            candidates,
            key=lambda item: (
                item["objectiveValue"]
                if isinstance(item.get("objectiveValue"), (int, float))
                else (item["score"] if isinstance(item.get("score"), (int, float)) else float("inf")),
                item.get("seed", 0),
            ),
        )

    def build_selected_result(option: Dict[str, Any] | None) -> Dict[str, Any]:
        ranked = []
        for index, candidate in enumerate(ranked_candidates()[:solution_count]):
            item = dict(candidate)
            item["rank"] = index + 1
            item["label"] = _build_option_label(candidate, index)
            ranked.append(item)
        selected = option or (ranked[0] if ranked else None)
        return {
            "ok": bool(selected),
            "error": None if selected else (
                (last_failure_result.get("error") if isinstance(last_failure_result, dict) else None)
                or last_error
                or "Failed to generate timetable"
            ),
            "generation_batch_id": generation_batch_id,
            "optionsGenerated": len(ranked),
            "selected_option_id": selected.get("optionId") if selected else None,
            "score": selected.get("score") if selected else None,
            "objectiveValue": selected.get("objectiveValue") if selected else None,
            "class_timetables": selected.get("class_timetables") if selected else (
                last_failure_result.get("class_timetables") if isinstance(last_failure_result, dict) else None
            ),
            "faculty_timetables": selected.get("faculty_timetables") if selected else (
                last_failure_result.get("faculty_timetables") if isinstance(last_failure_result, dict) else None
            ),
            "faculty_daily_hours": selected.get("faculty_daily_hours") if selected else (
                last_failure_result.get("faculty_daily_hours") if isinstance(last_failure_result, dict) else None
            ),
            "classes": selected.get("classes") if selected else (
                last_failure_result.get("classes") if isinstance(last_failure_result, dict) else classes
            ),
            "combos": selected.get("combos") if selected else (
                last_failure_result.get("combos") if isinstance(last_failure_result, dict) else combos
            ),
            "config": selected.get("config") if selected else (
                last_failure_result.get("config") if isinstance(last_failure_result, dict) else constraint_config
            ),
            "allocations_report": selected.get("allocations_report") if selected else None,
            "unmet_requirements": selected.get("unmet_requirements") if selected else (
                (last_failure_result.get("unmet_requirements") if isinstance(last_failure_result, dict) else None) or []
            ),
            "warnings": selected.get("warnings") if selected else (
                (last_failure_result.get("warnings") if isinstance(last_failure_result, dict) else None) or []
            ),
            "solver_stats": selected.get("solver_stats") if selected else (
                last_failure_result.get("solver_stats") if isinstance(last_failure_result, dict) else None
            ),
            "strategy": selected.get("strategy") if selected else (
                last_failure_result.get("strategy") if isinstance(last_failure_result, dict) else None
            ),
            "diagnostics": selected.get("diagnostics") if selected else (
                last_failure_result.get("diagnostics") if isinstance(last_failure_result, dict) else None
            ),
            "hint": selected.get("hint") if selected else (
                last_failure_result.get("hint") if isinstance(last_failure_result, dict) else None
            ),
            "reason": selected.get("reason") if selected else (
                last_failure_result.get("reason") if isinstance(last_failure_result, dict) else None
            ),
            "preview_stats": selected.get("preview_stats") if selected else (
                last_failure_result.get("preview_stats") if isinstance(last_failure_result, dict) else None
            ),
            "attemptsTried": attempts_run,
            "generation_options": ranked,
            "bestClassTimetables": selected.get("class_timetables") if selected else None,
            "bestFacultyTimetables": selected.get("faculty_timetables") if selected else None,
            "bestFacultyDailyHours": selected.get("faculty_daily_hours") if selected else None,
            "bestScore": selected.get("score") if selected else None,
            "batch_stats": {
                "attemptsPlanned": max_attempts,
                "attemptsTried": attempts_run,
                "uniqueCandidatesFound": len(candidates),
                "duplicateHashSkips": duplicate_hash_skips,
                "nearDuplicateSkips": similar_skips,
                "infeasibleAttempts": infeasible_attempts,
                "gapRejections": gap_rejections,
                "stopReason": stop_reason,
            },
        }

    # Phase 1: Feasibility - find any valid timetable with relaxed constraints
    configured_time_limit = float(
        _cfg_get(constraint_config, ["solver", "timeLimitSec"], payload.get("solver_time_limit_sec") or DEFAULT_SOLVER_TIME_LIMIT_SEC)
    )
    feasibility_config = copy.deepcopy(constraint_config)
    feasibility_config.setdefault("noGaps", {})["hard"] = False
    feasibility_config.setdefault("teacherAvailability", {})["hard"] = False
    feasibility_config.setdefault("solver", {})["maxCandidatesPerCombo"] = 0  # Unlimited
    feasibility_config.setdefault("solver", {})["earlyAbortNoSolution"] = False
    feasibility_config.setdefault("weeklySubjectHours", {})["hard"] = False  # Allow partial for feasibility
    # Relax weights
    for section in feasibility_config:
        if isinstance(feasibility_config[section], dict):
            for key in list(feasibility_config[section].keys()):
                if "weight" in key.lower() and isinstance(feasibility_config[section][key], (int, float)):
                    feasibility_config[section][key] = max(1, feasibility_config[section][key] // 2)

    progress_callback and progress_callback({"progress": 10, "phase": "feasibility_start"})
    feasibility_time_limit_sec = max(60.0, min(configured_time_limit, configured_time_limit * 0.25))
    feasibility_result = solve_instance({
        "faculties": faculties,
        "subjects": subjects,
        "classes": classes,
        "combos": combos,
        "DAYS_PER_WEEK": days_per_week,
        "HOURS_PER_DAY": hours_per_day,
        "fixedSlots": fixed_slots,
        "constraintConfig": feasibility_config,
        "random_seed": 42,  # Fixed seed for feasibility
        "solver_time_limit_sec": feasibility_time_limit_sec,
    })
    if feasibility_result.get("ok"):
        progress_callback and progress_callback({"progress": 50, "phase": "feasibility_found"})
        # Return feasibility result immediately if it works
        return {
            "ok": True,
            "generation_batch_id": f"feasibility_{int(__import__('time').time() * 1000)}",
            "optionsGenerated": 1,
            "selected_option_id": "feasibility_solution",
            "score": _analyze_class_internal_gaps(feasibility_result.get("class_timetables") or {}).get("gapCount", 0),
            "objectiveValue": feasibility_result.get("objective_value", 0),
            "class_timetables": feasibility_result.get("class_timetables"),
            "faculty_timetables": feasibility_result.get("faculty_timetables"),
            "faculty_daily_hours": feasibility_result.get("faculty_daily_hours"),
            "classes": feasibility_result.get("classes") or classes,
            "combos": combos,
            "config": feasibility_result.get("config") or feasibility_config,
            "allocations_report": feasibility_result.get("allocations_report"),
            "unmet_requirements": feasibility_result.get("unmet_requirements") or [],
            "warnings": feasibility_result.get("warnings") or [],
            "solver_stats": feasibility_result.get("solver_stats"),
            "strategy": {"name": "feasibility_relaxed", "phase": "feasibility"},
            "diagnostics": feasibility_result.get("diagnostics"),
            "hint": "Feasibility solution found",
            "reason": "feasibility_success",
            "preview_stats": feasibility_result.get("preview_stats"),
            "attemptsTried": 1,
            "generation_options": [{
                "optionId": "feasibility_solution",
                "rank": 1,
                "label": "Feasibility Solution",
                "score": _analyze_class_internal_gaps(feasibility_result.get("class_timetables") or {}).get("gapCount", 0),
                "objectiveValue": feasibility_result.get("objective_value", 0),
            }],
            "bestClassTimetables": feasibility_result.get("class_timetables"),
            "bestFacultyTimetables": feasibility_result.get("faculty_timetables"),
            "bestFacultyDailyHours": feasibility_result.get("faculty_daily_hours"),
            "bestScore": _analyze_class_internal_gaps(feasibility_result.get("class_timetables") or {}).get("gapCount", 0),
            "batch_stats": {
                "attemptsPlanned": 1,
                "attemptsTried": 1,
                "uniqueCandidatesFound": 1,
                "duplicateHashSkips": 0,
                "nearDuplicateSkips": 0,
                "infeasibleAttempts": 0,
                "gapRejections": 0,
                "stopReason": "feasibility_success",
            },
        }
        # Add feasibility solution to candidates for optimization
        candidates.append({
            "optionId": "feasibility_solution",
            "seed": 42,
            "score": _analyze_class_internal_gaps(feasibility_result.get("class_timetables") or {}).get("gapCount", 0),
            "objectiveValue": feasibility_result.get("objective_value", 0),
            "class_timetables": feasibility_result.get("class_timetables"),
            "faculty_timetables": feasibility_result.get("faculty_timetables"),
            "faculty_daily_hours": feasibility_result.get("faculty_daily_hours"),
            "classes": feasibility_result.get("classes") or classes,
            "combos": combos,
            "config": feasibility_result.get("config") or feasibility_config,
            "allocations_report": feasibility_result.get("allocations_report"),
            "unmet_requirements": feasibility_result.get("unmet_requirements") or [],
            "warnings": feasibility_result.get("warnings") or [],
            "solver_stats": feasibility_result.get("solver_stats"),
        })
        if len(candidates) >= solution_count:
            progress_callback and progress_callback({"progress": 100, "phase": "completed"})
            return build_selected_result(ranked_candidates()[0] if ranked_candidates() else None)
    else:
        progress_callback and progress_callback({"progress": 10, "phase": "feasibility_failed"})
    attempts = max(12, int(payload.get("attempts") or 12))
    enforce_hard_no_gaps = False  # Disable gap rejection to avoid over-constraining

    generation_batch_id = f"gen_{int(__import__('time').time() * 1000)}_{os.urandom(3).hex()}"
    seen_hashes = set()
    attempts_run = 0
    last_error = None
    last_failure_result: Dict[str, Any] | None = None
    duplicate_hash_skips = 0
    similar_skips = 0
    infeasible_attempts = 0
    gap_rejections = 0
    adaptive_relax = False  # New: adaptive constraint relaxation
    stop_reason = "attempt_budget_exhausted"
    started = __import__("time").time()
    total_time_limit = max(60.0, configured_time_limit)
    print(f"Configured time limit: {configured_time_limit} seconds ({configured_time_limit/60:.1f} minutes)")
    print(f"Total time limit: {total_time_limit} seconds ({total_time_limit/60:.1f} minutes)")
    min_solver_time_per_attempt_sec = max(
        5.0,
        float(_cfg_get(constraint_config, ["solver", "minTimePerAttemptSec"], 15)),
    )
    min_candidate_difference_ratio = min(
        0.25,
        max(0.0, float(_cfg_get(constraint_config, ["solver", "minCandidateDifferenceRatio"], 0.005))),
    )
    budget_driven_attempt_cap = max(
        1,
        int(configured_time_limit // max(5.0, min_solver_time_per_attempt_sec)),
    )
    max_attempts = max(12, budget_driven_attempt_cap)
    strategy_templates = [
        {
            "name": "strict",
            "maxCandidatesPerCombo": 0,  # Unlimited for first attempts
            "timeShare": 0.4,
            "earlyAbortNoSolution": False,
            "noSolutionAbortRatio": 0.45,
            "noSolutionAbortMinSec": 12,
            "relaxSoftConstraints": False,
        },
        {
            "name": "relaxed_constraints",
            "maxCandidatesPerCombo": 15,
            "timeShare": 0.2,
            "earlyAbortNoSolution": False,
            "noSolutionAbortRatio": 0.3,
            "noSolutionAbortMinSec": 8,
            "relaxSoftConstraints": True,
        },
        {
            "name": "reduced_search",
            "maxCandidatesPerCombo": 10,
            "timeShare": 0.25,
            "earlyAbortNoSolution": False,
            "noSolutionAbortRatio": 0.35,
            "noSolutionAbortMinSec": 10,
            "relaxSoftConstraints": False,
        },
        {
            "name": "aggressive_fast",
            "maxCandidatesPerCombo": 8,
            "timeShare": 0.15,
            "earlyAbortNoSolution": False,
            "noSolutionAbortRatio": 0.25,
            "noSolutionAbortMinSec": 6,
            "relaxSoftConstraints": True,
        },
    ]
    attempt_plans: List[Dict[str, Any]] = []
    for attempt_index in range(max_attempts):
        template = strategy_templates[attempt_index % len(strategy_templates)]
        if skip_strict and template["name"] == "strict" and attempt_index >= 5:
            continue
        cycle = attempt_index // len(strategy_templates)
        strategy = dict(template)
        strategy["cycle"] = cycle
        strategy["attemptIndex"] = attempt_index
        strategy["seed"] = attempt_index + 1
        if cycle > 0:
            strategy["name"] = f"{strategy['name']}_cycle_{cycle + 1}"
        attempt_plans.append(strategy)
    total_time_share = sum(float(plan.get("timeShare") or 0) for plan in attempt_plans) or 1.0

    def is_good_enough(candidate: Dict[str, Any], difficulty: str) -> bool:
        # Require perfect solution: no unmet requirements, no warnings, score 0
        return (
            not candidate.get("unmet_requirements")
            and len(candidate.get("warnings") or []) == 0
            and (candidate.get("score") or 0) == 0
        )

    for attempt, strategy in enumerate(attempt_plans):
        if cancel_check and cancel_check():
            stop_reason = "cancel_requested"
            return {
                "ok": False,
                "error": "Generation cancelled",
                "generation_options": ranked_candidates()[:solution_count],
            }

        elapsed_sec = __import__("time").time() - started
        if elapsed_sec > total_time_limit:
            stop_reason = "global_timeout"
            break

        # Adaptive difficulty analysis and constraint adjustment - DISABLED for fast version
        # difficulty = analyze_difficulty(
        #     infeasible_attempts,
        #     attempts_run,
        #     len(candidates),
        #     elapsed_sec
        # )
        # adaptive_config = adapt_constraints(
        #     constraint_config,
        #     difficulty,
        #     attempt
        # )
        difficulty = "unknown"
        adaptive_config = constraint_config

        remaining_budget_sec = configured_time_limit - elapsed_sec
        if remaining_budget_sec <= 0:
            last_error = "Solver time budget exhausted"
            stop_reason = "time_budget_exhausted"
            break

        remaining_attempts = max_attempts - attempt
        remaining_share = sum(
            float(plan.get("timeShare") or 0) for plan in attempt_plans[attempt:]
        ) or 1.0
        target_time_share = float(strategy.get("timeShare") or 0) / remaining_share
        per_attempt_time_limit_sec = min(
            get_adaptive_time_limit(difficulty, configured_time_limit),  # Adaptive time limit scales with the configured budget
            max(
                min_solver_time_per_attempt_sec,
                min(
                    configured_time_limit * (float(strategy.get("timeShare") or 0) / total_time_share),
                    remaining_budget_sec * target_time_share,
                ),
            ),
        )
        if per_attempt_time_limit_sec > remaining_budget_sec:
            stop_reason = "insufficient_remaining_budget_for_attempt"
            break

        progress_start = int((attempt * 100) / max(1, max_attempts))
        progress_end = int(((attempt + 1) * 100) / max(1, max_attempts))
        attempts_run += 1
        seed = attempt + 1
        progress_callback and progress_callback({"progress": progress_start, "phase": "start"})
        attempt_constraint_config = _build_attempt_constraint_config(
            adaptive_config,  # Use adaptive config
            strategy,
            per_attempt_time_limit_sec,
            False,  # adaptive_relax disabled
            difficulty,
        )

        expected_ms = max(15_000, int(per_attempt_time_limit_sec * 1000))
        progress_span = max(1, progress_end - progress_start)
        cap_before_done = min(99, max(progress_start, progress_end - 1))
        heartbeat_stop = threading.Event()
        attempt_started_at = time.time()
        current_progress = progress_start

        def emit_progress(value: float, phase: str = "running") -> None:
            nonlocal current_progress
            clamped = max(progress_start, min(cap_before_done, round(value)))
            current_progress = max(current_progress, clamped)
            progress_callback and progress_callback({"progress": clamped, "phase": phase})

        def heartbeat() -> None:
            while not heartbeat_stop.wait(1.0):
                elapsed_ms = int((time.time() - attempt_started_at) * 1000)
                ratio = min(1.0, elapsed_ms / max(1, expected_ms))
                eased = ratio  # Changed to linear progress instead of eased
                emit_progress(progress_start + eased * progress_span, "running")

        heartbeat_thread = threading.Thread(target=heartbeat, daemon=True)
        heartbeat_thread.start()

        try:
            result = solve_instance(
                {
                    "faculties": faculties,
                    "subjects": subjects,
                    "classes": classes,
                    "combos": combos,
                    "DAYS_PER_WEEK": days_per_week,
                    "HOURS_PER_DAY": hours_per_day,
                    "fixedSlots": fixed_slots,
                    "constraintConfig": attempt_constraint_config,
                    "random_seed": int(strategy.get("seed") or seed),
                    "solver_time_limit_sec": per_attempt_time_limit_sec,
                }
            )
        except Exception as exc:
            last_error = f"Solver crashed: {str(exc) or exc.__class__.__name__}"
            infeasible_attempts += 1
            last_failure_result = {
                "ok": False,
                "error": last_error,
                "strategy": strategy.get("name"),
            }
            progress_callback and progress_callback({"progress": current_progress, "phase": "running"})
            continue
        finally:
            heartbeat_stop.set()
            heartbeat_thread.join(timeout=0.2)

        if not result.get("ok"):
            last_error = result.get("error") or "Unknown generator failure"
            infeasible_attempts += 1
            if infeasible_attempts > 2:
                pass  # Removed adaptive_relax
                # adaptive_relax = True  # Adaptive: relax constraints after 3 failures
            if infeasible_attempts >= 3 and len(candidates) == 0:
                # Force relaxation mode on failure spike
                constraint_config.setdefault("noGaps", {})["hard"] = False
                constraint_config.setdefault("teacherAvailability", {})["hard"] = False
            last_failure_result = {
                **result,
                "strategy": strategy.get("name"),
            }
            progress_callback and progress_callback({"progress": current_progress, "phase": "running"})
            continue

        progress_callback and progress_callback(
            {"progress": current_progress, "phase": "solver_done"}
        )

        gap_count = _analyze_class_internal_gaps(result.get("class_timetables") or {}).get("gapCount", 0)
        if enforce_hard_no_gaps and gap_count > 3:  # Allow up to 3 gaps instead of 0
            last_error = f"Generated timetable has {gap_count} internal class gaps (threshold: 3)"
            gap_rejections += 1
            progress_callback and progress_callback({"progress": current_progress, "phase": "running"})
            continue

        objective_value = result.get("objective_value")
        if not isinstance(objective_value, (int, float)):
            # Improved objective: gaps + unmet requirements + warnings
            unmet_count = len(result.get("unmet_requirements") or [])
            warning_count = len(result.get("warnings") or [])
            objective_value = gap_count + (unmet_count * 1000) + (warning_count * 100)

        timetable_hash = _hash_timetable(result.get("class_timetables") or {})
        if not timetable_hash or timetable_hash in seen_hashes:
            duplicate_hash_skips += 1
            progress_callback and progress_callback({"progress": current_progress, "phase": "running"})
            continue

        is_too_similar = False
        for candidate in candidates:
            diff = _compare_timetable_difference(
                candidate.get("class_timetables") or {},
                result.get("class_timetables") or {},
            )
            if diff["totalSlots"] > 0 and diff["differentSlots"] < max(
                3, int(diff["totalSlots"] * min_candidate_difference_ratio)
            ):
                is_too_similar = True
                break
        if is_too_similar and attempts_run >= 5:
            similar_skips += 1
            progress_callback and progress_callback({"progress": current_progress, "phase": "running"})
            continue

        seen_hashes.add(timetable_hash)
        solver_stats = dict(result.get("solver_stats") or {})
        solver_stats["attempt_strategy"] = strategy.get("name")
        solver_stats["attempt_cycle"] = strategy.get("cycle", 0)
        solver_stats["attempt_time_budget_seconds"] = float(per_attempt_time_limit_sec)
        candidates.append(
            {
                "optionId": f"{generation_batch_id}_opt_{len(candidates) + 1}",
                "seed": seed,
                "score": gap_count,
                "objectiveValue": objective_value,
                "class_timetables": result.get("class_timetables"),
                "faculty_timetables": result.get("faculty_timetables"),
                "faculty_daily_hours": result.get("faculty_daily_hours"),
                "classes": result.get("classes") or classes,
                "combos": combos,
                "config": result.get("config") or attempt_constraint_config,
                "allocations_report": result.get("allocations_report"),
                "unmet_requirements": result.get("unmet_requirements") or [],
                "warnings": result.get("warnings") or [],
                "solver_stats": solver_stats,
                "strategy": strategy.get("name"),
            }
        )

        if is_good_enough(candidates[-1], difficulty) and attempts_run >= 5:  # Increased from 2 to 5
            stop_reason = "adaptive_good_enough"
            break

        best = ranked_candidates()[0] if ranked_candidates() else None
        progress_callback and progress_callback(
            {
                "progress": max(current_progress, min(94, round(current_progress + 2))),
                "phase": "candidate_ready",
                "partialData": build_selected_result(best),
            }
        )

        if len(candidates) >= max(solution_count, solution_count * 3):
            stop_reason = "target_unique_candidates_reached"
            break

    best = ranked_candidates()[0] if ranked_candidates() else None
    elapsed_total = __import__("time").time() - started
    print(f"Solver completed after {elapsed_total:.1f} seconds. Stop reason: {stop_reason}")
    print(f"Found {len(candidates)} candidates. Best score: {best.get('score') if best else 'None'}")
    if best:
        progress_callback and progress_callback({"progress": 100, "phase": "completed"})
    return build_selected_result(best)


async def _process_generation_job(job_id: str, payload: Dict[str, Any]) -> None:
    last_progress = 0

    def cancel_check() -> bool:
        return _is_cancel_requested(job_id)

    def progress_callback(message: Dict[str, Any]) -> None:
        nonlocal last_progress
        next_progress = max(0, min(100, int(message.get("progress") or 0)))
        last_progress = max(last_progress, next_progress)
        update = {
            "status": "running",
            "phase": message.get("phase") or "running",
            "progress": next_progress,
        }
        if message.get("partialData") is not None:
            update["partial_data"] = message.get("partialData")
        _set_job_state(job_id, **update)

    try:
        _set_job_state(job_id, status="running", phase="start", progress=0, error=None)
        result = await asyncio.to_thread(
            _run_generation_batch,
            payload,
            progress_callback,
            cancel_check,
        )

        if cancel_check() and not result.get("ok"):
            _set_job_state(
                job_id,
                status="cancelled",
                phase="cancelled",
                progress=min(last_progress, 95),
                error=result.get("error") or "Generation cancelled",
                result=result,
            )
            return

        final_status = "completed" if result.get("ok") else "failed"
        final_phase = "completed" if result.get("ok") else "error"
        final_progress = 100 if result.get("ok") else min(last_progress, 95)
        persistence_error = None
        if result.get("ok"):
            try:
                await asyncio.to_thread(_persist_completed_timetable, job_id, result)
            except Exception as exc:
                persistence_error = str(exc) or "Failed to persist completed timetable"
        _set_job_state(
            job_id,
            status=final_status,
            phase=final_phase,
            progress=final_progress,
            result=result,
            partial_data=(
                result
                if (
                    result.get("ok")
                    or result.get("partialData") is not None
                    or result.get("preview_stats") is not None
                    or isinstance(result.get("class_timetables"), dict)
                )
                else None
            ),
            error=(
                persistence_error
                if result.get("ok") and persistence_error
                else (None if result.get("ok") else (result.get("error") or "Generation failed"))
            ),
        )

        # Stop EC2 instance after job completion to save costs
        _stop_ec2_instance()

    except Exception as exc:
        _set_job_state(
            job_id,
            status="failed",
            phase="error",
            progress=min(last_progress, 95),
            error=str(exc) or "Generation failed",
        )

        # Stop EC2 instance even on error to save costs
        _stop_ec2_instance()


def _spawn_generation_job(job_id: str, payload: Dict[str, Any]) -> None:
    task = asyncio.create_task(_process_generation_job(job_id, payload))
    ACTIVE_JOB_TASKS.add(task)
    task.add_done_callback(lambda done: ACTIVE_JOB_TASKS.discard(done))

def _solver_loop_exception_handler(loop, context):
    exc = context.get("exception")
    if isinstance(exc, ConnectionResetError):
        # Ignore noisy Windows socket shutdown resets from disconnected clients.
        if getattr(exc, "winerror", None) == 10054:
            return
    loop.default_exception_handler(context)


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


@app.on_event("startup")
async def _install_loop_handler():
    loop = asyncio.get_running_loop()
    loop.set_exception_handler(_solver_loop_exception_handler)
    # Resume any pending or running jobs on startup
    await _resume_pending_jobs()
    # Also keep picking up new pending jobs.
    asyncio.create_task(_poll_for_pending_jobs())


@app.get("/health")
def health() -> Dict[str, str]:
    return {"ok": "true"}


@app.post("/jobs")
async def start_job(request: Request) -> Dict[str, Any]:
    print("=== /jobs endpoint called ===")
    body = await request.json()
    print("=== Body received ===")

    # DEBUG: Log received payload
    print("=== RECEIVED PAYLOAD SUMMARY ===")
    payload_data = body.get("payload", {})
    print(f"jobId: {body.get('jobId')}")
    print(f"classes: {len(payload_data.get('classes', []))}")
    print(f"subjects: {len(payload_data.get('subjects', []))}")
    print(f"faculties: {len(payload_data.get('faculties', []))}")
    print(f"combos: {len(payload_data.get('combos', []))}")
    print(f"fixedSlots: {len(payload_data.get('fixedSlots', []))}")
    print(f"DAYS_PER_WEEK: {payload_data.get('DAYS_PER_WEEK')}")
    print(f"HOURS_PER_DAY: {payload_data.get('HOURS_PER_DAY')}")
    if DEBUG_DUMP_PAYLOADS:
        print("Full payload saved to received_payload.json")
    print("=== RECEIVED PAYLOAD SUMMARY END ===")

    if DEBUG_DUMP_PAYLOADS:
        try:
            with open("received_payload.json", "w", encoding="utf-8") as f:
                json.dump(body, f, indent=2, default=_json_default)
        except Exception as exc:
            print(f"Failed to dump received payload: {exc}")

    # DEBUG: Quick counts (already in summary)
    # payload_data = body.get("payload", {})
    # print("classes:", len(payload_data.get("classes", [])))
    # print("subjects:", len(payload_data.get("subjects", [])))
    # print("faculties:", len(payload_data.get("faculties", [])))
    # print("combos:", len(payload_data.get("combos", [])))

    job_id = str(body.get("jobId") or "").strip()
    payload = body.get("payload") or {}
    if not job_id:
        return {"ok": False, "error": "jobId is required"}

    _set_job_state(job_id, status="pending", phase="queued", progress=0, error=None)
    _spawn_generation_job(job_id, payload)
    return {"ok": True, "jobId": job_id}


def solve_instance(payload: Dict[str, Any]) -> Dict[str, Any]:
    constraint_config = payload.get("constraintConfig") or {}
    debug_labs = str(os.getenv("DEBUG_LAB_ALLOCATION", "")).strip().lower() in ("1", "true", "yes", "on")
    input_mode = payload.get("inputMode", "EXPLICIT")
    
    if DEBUG:
        print(f"[solve_instance] Input mode: {input_mode}")
        print(f"[solve_instance] Combos count: {len(payload.get('combos', []))}")

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
            payload.get("solver_time_limit_sec") or DEFAULT_SOLVER_TIME_LIMIT_SEC,
        )
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
        print("[solve_instance] payload summary", {
            "classes": len(classes),
            "subjects": len(subjects),
            "combos": len(combos),
            "labSubjects": target_subjects,
        })
        for cls in classes:
            class_id = cls["_id"]
            combo_ids = [
                combo["_id"]
                for combo in combos
                if class_id in [str(cid) for cid in (combo.get("class_ids") or [])]
            ]
            print("[solve_instance] class combos", {
                "classId": class_id,
                "className": cls.get("name") or class_id,
                "comboCount": len(combo_ids),
                "comboIds": combo_ids[:20],
            })
        for combo in combos:
            combo_subject = subject_by_id.get(combo.get("subject_id"))
            combo_subject_type = str(combo_subject.get("type") or "").lower() if combo_subject else ""
            if combo_subject_type != "lab":
                continue
            print("[solve_instance] lab combo normalized", {
                "comboId": combo.get("_id"),
                "subjectId": combo.get("subject_id"),
                "subjectName": (combo_subject.get("name") if combo_subject else None) or combo.get("subject_id"),
                "classIds": combo.get("class_ids", []),
                "facultyIds": combo.get("faculty_ids", []),
                "rawKeys": sorted(list(combo.keys()))[:40],
            })

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
    class_slot_pressure: Dict[Tuple[str, int, int], int] = {}
    teacher_slot_pressure: Dict[Tuple[str, int, int], int] = {}

    for combo in combos:
        combo_id = combo["_id"]
        class_ids = [cid for cid in (combo.get("class_ids") or []) if cid in class_by_id]
        if not class_ids:
            if DEBUG:
                print(f"[DEBUG] Skipping combo {combo_id}: no valid class_ids")
            continue
        subj = subject_by_id.get(combo["subject_id"])
        if not subj:
            if DEBUG:
                print(f"[DEBUG] Skipping combo {combo_id}: subject {combo['subject_id']} not found")
            continue
        required_hours_list = [required_hours_by_class_subject[cid].get(combo["subject_id"], 0) for cid in class_ids]
        if all(h <= 0 for h in required_hours_list):
            if DEBUG:
                print(f"[DEBUG] Skipping combo {combo_id}: no required hours for classes {class_ids}, subject {combo['subject_id']}, hours: {required_hours_list}")
            continue
        block = lab_block_size if subj.get("type") == "lab" else theory_block_size
        max_days_for_combo = min(
            [int(class_by_id[cid].get("days_per_week") or DAYS_PER_WEEK) for cid in class_ids] or [DAYS_PER_WEEK]
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

        if debug_labs and str(subj.get("type") or "").lower() == "lab":
            print("[solve_instance] lab candidate scan", {
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
            })

        if not candidate_starts:
            if DEBUG:
                print(f"[DEBUG] Skipping combo {combo_id}: no candidate starts (block={block}, days={max_days_for_combo})")
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
        subj = subject_by_id.get(combo["subject_id"])
        if not class_ids or not candidate_starts:
            if debug_labs and subj and str(subj.get("type") or "").lower() == "lab":
                print("[solve_instance] skipping lab combo during search", {
                    "comboId": combo_id,
                    "subjectId": combo["subject_id"],
                    "subjectName": subj.get("name") or combo["subject_id"],
                    "classIds": class_ids,
                    "candidateStarts": len(candidate_starts),
                })
            continue
        if not subj:
            continue
        block = lab_block_size if subj.get("type") == "lab" else theory_block_size
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
        if max_candidates_per_combo > 0 and len(ordered_starts) > max_candidates_per_combo:
            fixed_starts = [
                slot for slot in ordered_starts if (combo_id, slot[0], slot[1]) in fixed_slot_keys
            ]
            non_fixed_starts = [
                slot for slot in ordered_starts if (combo_id, slot[0], slot[1]) not in fixed_slot_keys
            ]
            remaining_capacity = max(0, max_candidates_per_combo - len(fixed_starts))
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
        max_days = max([int(c.get("days_per_week") or DAYS_PER_WEEK) for c in classes] or [DAYS_PER_WEEK])

        class_timetables: Dict[str, List[List[Any]]] = {}
        for cls in classes:
            class_id = cls["_id"]
            days = int(cls.get("days_per_week") or DAYS_PER_WEEK)
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
            subj = subject_by_id.get(combo["subject_id"])
            if not subj:
                continue
            block = lab_block_size if subj.get("type") == "lab" else theory_block_size
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
                        day >= int(class_by_id[class_id].get("days_per_week") or DAYS_PER_WEEK)
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
            terms = [var * block for (var, block) in pairs]
            if debug_labs and req > 0 and str(subj.get("type") or "").lower() == "lab":
                print("[solve_instance] class subject coverage", {
                    "classId": class_id,
                    "className": cls.get("name") or class_id,
                    "subjectId": subj_id,
                    "subjectName": subj.get("name") or subj_id,
                    "requiredHours": req,
                    "candidateCount": len(pairs),
                    "block": lab_block_size,
                })

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

    # Soft constraint: daily compactness per class.
    # Keep each day's occupied block as far left as possible after the hard no-gap rule.
    if daily_compactness_enabled and daily_compactness_weight > 0:
        for cls in classes:
            class_id = cls["_id"]
            days = int(cls.get("days_per_week") or DAYS_PER_WEEK)
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
            days = int(cls.get("days_per_week") or DAYS_PER_WEEK)
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


@app.post("/solve")
async def solve(request: Request) -> Dict[str, Any]:
    payload = await request.json()
    return solve_instance(payload)
