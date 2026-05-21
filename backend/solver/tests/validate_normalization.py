from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from input.normalize import normalize_solver_payload


def load_json(path: Path):
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def main() -> int:
    fixtures_dir = Path(__file__).resolve().parent / "fixtures"
    payload_files = sorted(fixtures_dir.rglob("*.payload.json"))
    if not payload_files:
        print("No fixtures found.")
        return 1

    failed = False
    for payload_file in payload_files:
        expected_file = payload_file.with_name(payload_file.name.replace(".payload.json", ".expected.json"))
        if not expected_file.exists():
            print(f"Missing expected fixture for {payload_file.name}")
            failed = True
            continue

        payload = load_json(payload_file)
        expected = load_json(expected_file)
        normalized = normalize_solver_payload(payload)
        actual = normalized.summary()

        if actual != expected:
            failed = True
            print(f"Fixture mismatch: {payload_file.name}")
            print("Expected:")
            print(json.dumps(expected, indent=2, sort_keys=True))
            print("Actual:")
            print(json.dumps(actual, indent=2, sort_keys=True))
        else:
            print(f"OK: {payload_file.name}")

    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
