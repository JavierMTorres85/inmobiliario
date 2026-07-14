"""Archive a reproducible dashboard data cut before replacing current values."""

from __future__ import annotations

import argparse
from datetime import date
import json
from pathlib import Path
import shutil


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
INDEX = DATA / "releases.json"
FILES = (
    "municipalities.json",
    "districts.json",
    "neighborhoods.json",
    "zones.json",
    "manifest.json",
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("release_id", help="Stable identifier, for example 2026-07-14")
    parser.add_argument("--label", default="Corte de datos")
    parser.add_argument("--date", default=date.today().isoformat())
    args = parser.parse_args()

    target = DATA / "history" / args.release_id
    if target.exists():
        raise SystemExit(f"Release already exists: {target.relative_to(ROOT)}")
    target.mkdir(parents=True)
    for filename in FILES:
        shutil.copyfile(DATA / filename, target / filename)

    payload = (
        json.loads(INDEX.read_text(encoding="utf-8"))
        if INDEX.exists()
        else {"schema_version": 1, "releases": []}
    )
    payload["releases"].append(
        {
            "id": args.release_id,
            "date": args.date,
            "label": args.label,
            "path": f"history/{args.release_id}",
        }
    )
    payload["releases"].sort(key=lambda item: item["date"], reverse=True)
    INDEX.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Archived {len(FILES)} files in {target.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
