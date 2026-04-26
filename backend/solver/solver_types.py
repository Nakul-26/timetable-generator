"""
Type definitions and data contracts for the timetable solver.
"""

from typing import Dict, List, Any, Optional
from pydantic import BaseModel


class Combo(BaseModel):
    _id: str
    subject_id: str
    class_ids: List[str]
    faculty_ids: List[str]
    # Additional fields as needed


class Class(BaseModel):
    _id: str
    name: Optional[str] = None
    days_per_week: Optional[int] = None
    subject_hours: Optional[Dict[str, int]] = None


class Subject(BaseModel):
    _id: str
    name: Optional[str] = None
    type: Optional[str] = None  # "theory" or "lab"
    no_of_hours_per_week: Optional[int] = None


class Faculty(BaseModel):
    _id: str
    name: Optional[str] = None


class SolverInput(BaseModel):
    classes: List[Dict[str, Any]]
    subjects: List[Dict[str, Any]]
    faculties: List[Dict[str, Any]]
    combos: List[Dict[str, Any]]
    DAYS_PER_WEEK: int = 6
    HOURS_PER_DAY: int = 8
    constraintConfig: Dict[str, Any] = {}
    mode: str = "college"
    fixedSlots: List[Dict[str, Any]] = []
    random_seed: int = 1
    solver_time_limit_sec: float = 180.0


class SolverOutput(BaseModel):
    ok: bool
    error: Optional[str] = None
    class_timetables: Optional[Dict[str, List[List[Any]]]] = None
    faculty_timetables: Optional[Dict[str, List[List[Any]]]] = None
    score: Optional[float] = None
    diagnostics: Optional[Dict[str, Any]] = None