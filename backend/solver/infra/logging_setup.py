import logging
import os
from typing import Optional


def configure_logging(*, debug: bool = False, level_name: Optional[str] = None) -> None:
    """Configure root logging once.

    - If handlers already exist (e.g., Uvicorn), do nothing.
    - Otherwise, call basicConfig with a sane format.
    """

    root = logging.getLogger()
    if root.handlers:
        return

    env_level = os.getenv("SOLVER_LOG_LEVEL")
    effective_name = (level_name or env_level or ("DEBUG" if debug else "INFO")).upper()
    level = getattr(logging, effective_name, logging.INFO)

    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )


def get_logger(name: str = "timetable.solver") -> logging.Logger:
    return logging.getLogger(name)
