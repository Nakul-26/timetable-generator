from __future__ import annotations

from typing import Any, Dict, List, Tuple


EMPTY = -1
BREAK = "BREAK"

DEFAULT_SOLVER_TIME_LIMIT_SEC = 180.0
DEFAULT_SOLUTION_COUNT = 2


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
                if isinstance(day, (int, float, str))
                and str(day).strip().isdigit()
                and int(day) >= 0
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
