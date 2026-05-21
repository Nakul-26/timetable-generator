from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from engine.solve import solve_instance


def main() -> int:
    fixtures_dir = Path(__file__).resolve().parent / "fixtures" / "infeasible"
    payload_files = sorted(fixtures_dir.glob("*.payload.json"))
    if not payload_files:
        print("No infeasible fixtures found.")
        return 1

    failed = False
    for payload_file in payload_files:
        with payload_file.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)

        result = solve_instance(payload)
        solver_status = (result.get("solver_stats") or {}).get("status")
        if result.get("ok") is not False or solver_status not in {"INFEASIBLE", "MODEL_INVALID"}:
            failed = True
            print(
                f"Expected infeasible result for {payload_file.name}, "
                f"got ok={result.get('ok')} status={solver_status}"
            )
            continue

        print(f"OK: {payload_file.name} is {solver_status}")

    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())

