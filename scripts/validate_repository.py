"""Validate committed JSON files and reject likely embedded Idealista secrets."""

from __future__ import annotations

import json
from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]
TEXT_SUFFIXES = {".html", ".js", ".mjs", ".json", ".md", ".py", ".txt", ".yaml", ".yml"}
SECRET_PATTERN = re.compile(
    r"(?i)IDEALISTA_API_(?:KEY|SECRET)\s*[:=]\s*[\"']([^\"']+)[\"']"
)
SAFE_VALUES = {"...", "placeholder", "replace_me", "your_api_key", "your_api_secret"}


def validate_json() -> int:
    checked = 0
    paths = [*ROOT.rglob("*.json"), *ROOT.rglob("*.geojson")]
    for path in paths:
        relative_parts = path.relative_to(ROOT).parts
        if any(part.startswith(".") or part == "node_modules" for part in relative_parts):
            continue
        json.loads(path.read_text(encoding="utf-8"))
        checked += 1
    return checked


def find_likely_secrets() -> list[str]:
    findings: list[str] = []
    for path in ROOT.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in TEXT_SUFFIXES:
            continue
        if any(part in {".git", ".venv", "__pycache__", "node_modules"} for part in path.parts):
            continue
        text = path.read_text(encoding="utf-8")
        for match in SECRET_PATTERN.finditer(text):
            value = match.group(1).strip().lower()
            if value in SAFE_VALUES or value.startswith("${{"):
                continue
            findings.append(f"{path.relative_to(ROOT)} contains a literal Idealista credential assignment")
    return findings


def validate_geography_coverage() -> None:
    pairs = (
        ("municipalities", "municipalities.geojson", "mun_code"),
        ("districts", "districts.geojson", "cartodb_id"),
        ("neighborhoods", "neighborhoods.geojson", "COD_DISBAR"),
    )
    for dataset, geometry, property_name in pairs:
        records = json.loads((ROOT / "data" / f"{dataset}.json").read_text(encoding="utf-8"))
        collection = json.loads((ROOT / "data" / "geo" / geometry).read_text(encoding="utf-8"))
        codes = {str(feature["properties"][property_name]) for feature in collection["features"]}
        if codes != set(records):
            missing = sorted(set(records) - codes)
            extra = sorted(codes - set(records))
            raise SystemExit(f"{geometry} code mismatch; missing={missing}, extra={extra}")


def validate_releases() -> int:
    index = json.loads((ROOT / "data" / "releases.json").read_text(encoding="utf-8"))
    required = {"municipalities.json", "districts.json", "neighborhoods.json", "zones.json", "manifest.json"}
    seen: set[str] = set()
    for release in index.get("releases", []):
        release_id = release["id"]
        if release_id in seen:
            raise SystemExit(f"Duplicate data release: {release_id}")
        seen.add(release_id)
        folder = ROOT / "data" / release["path"]
        missing = [filename for filename in required if not (folder / filename).is_file()]
        if missing:
            raise SystemExit(f"Release {release_id} is incomplete: {missing}")
    return len(seen)


def main() -> int:
    json_count = validate_json()
    validate_geography_coverage()
    release_count = validate_releases()
    findings = find_likely_secrets()
    if findings:
        raise SystemExit("\n".join(findings))
    print(
        f"Validated {json_count} JSON/GeoJSON files and {release_count} data release; "
        "no literal Idealista credentials detected"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
