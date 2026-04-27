import os
import threading
from typing import AbstractSet, Optional

import boto3

from .logging_setup import get_logger

logger = get_logger("timetable.solver.ec2")

_stop_lock = threading.Lock()
_stop_triggered = False


def stop_instance(*, instance_id: str, region: str) -> None:
    try:
        logger.info("Stopping EC2 instance %s...", instance_id)
        ec2 = boto3.client("ec2", region_name=region)
        ec2.stop_instances(InstanceIds=[instance_id])
        logger.info("EC2 instance stop request submitted")
    except Exception as exc:
        logger.exception("Failed to stop EC2 instance: %s", exc)


def maybe_stop_when_idle(
    *,
    active_tasks: AbstractSet[object],
    instance_id: Optional[str] = None,
    region: Optional[str] = None,
    enabled: Optional[bool] = None,
) -> None:
    """Stop instance only when there are no active tasks; triggers at most once."""

    global _stop_triggered

    resolved_instance_id = instance_id or os.getenv("EC2_INSTANCE_ID")
    if not resolved_instance_id:
        return

    resolved_enabled = enabled
    if resolved_enabled is None:
        resolved_enabled = os.getenv("EC2_STOP_ENABLED", "1").strip().lower() not in (
            "0",
            "false",
            "no",
            "off",
        )
    if not resolved_enabled:
        return

    if active_tasks:
        return

    with _stop_lock:
        if _stop_triggered:
            return
        _stop_triggered = True

    stop_instance(
        instance_id=resolved_instance_id,
        region=(region or os.getenv("AWS_REGION", "eu-north-1")),
    )
