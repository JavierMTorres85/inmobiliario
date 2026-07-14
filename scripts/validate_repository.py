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
    for path in ROOT.rglob("*.json"):
        if any(part.startswith(".") for part in path.relative_to(ROOT).parts):
            continue
        json.loads(path.read_text(encoding="utf-8"))
        checked += 1
    return checked


def find_likely_secrets() -> list[str]:
    findings: list[str] = []
    for path in ROOT.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in TEXT_SUFFIXES:
            continue
        if any(part in {".git", ".venv", "__pycache__"} for part in path.parts):
            continue
        text = path.read_text(encoding="utf-8")
        for match in SECRET_PATTERN.finditer(text):
            value = match.group(1).strip().lower()
            if value in SAFE_VALUES or value.startswith("${{"):
                continue
            findings.append(f"{path.relative_to(ROOT)} contains a literal Idealista credential assignment")
    return findings


def main() -> int:
    json_count = validate_json()
    findings = find_likely_secrets()
    if findings:
        raise SystemExit("\n".join(findings))
    print(f"Validated {json_count} JSON files; no literal Idealista credentials detected")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
