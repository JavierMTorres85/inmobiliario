"""Calculate metric coverage from the dashboard JSON instead of hand-counting it."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "data" / "manifest.json"
LEVELS = {
    "M": ("municipalities.json", 179),
    "D": ("districts.json", 21),
    "B": ("neighborhoods.json", 131),
}
FIELDS = {
    "pob": {"M": "p25", "D": "p25", "B": "cp"},
    "pre": {"M": "v", "D": "v", "B": "v"},
    "ren": {"M": "rb", "D": "rb", "B": "rb"},
    "esf": {"M": "esf", "D": "esf", "B": "esf"},
    "ten": {"M": "te", "D": "te", "B": "te"},
}


def calculated_coverage() -> dict[str, dict[str, str]]:
    data = {
        level: json.loads((ROOT / "data" / filename).read_text(encoding="utf-8"))
        for level, (filename, _) in LEVELS.items()
    }
    coverage: dict[str, dict[str, str]] = {}
    for metric, fields in FIELDS.items():
        coverage[metric] = {}
        for level, field in fields.items():
            total = LEVELS[level][1]
            count = sum(record.get(field) is not None for record in data[level].values())
            coverage[metric][level] = f"{count}/{total}"
    coverage["supply"] = {
        level: f"0/{total}" for level, (_, total) in LEVELS.items()
    }
    return coverage


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()

    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    calculated = calculated_coverage()
    mismatches = []
    for metric, values in calculated.items():
        committed = manifest["metrics"][metric].get("coverage")
        if committed != values:
            mismatches.append(f"{metric}: committed={committed}, calculated={values}")

    if args.check:
        if mismatches:
            raise SystemExit("Coverage manifest is stale:\n" + "\n".join(mismatches))
        print("Metric coverage matches the committed dashboard data")
        return 0

    for metric, values in calculated.items():
        manifest["metrics"][metric]["coverage"] = values
    MANIFEST.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print("Updated data/manifest.json coverage")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
